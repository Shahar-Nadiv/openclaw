use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const RESUME_ATTEMPTS: usize = 3;
const RESUME_RETRY_DELAY: Duration = Duration::from_secs(2);

/// How long awake before we conclude the sleep we prepared for never happened.
///
/// Measured on the monotonic clock, which does not advance while the machine is
/// suspended — so this can only elapse if the host genuinely stayed up. A real sleep,
/// however long, cannot trip it.
const AWAKE_AFTER_PREPARING: Duration = Duration::from_secs(60);

type PrepareFuture = Pin<Box<dyn Future<Output = Result<SleepPrepareOutcome, String>> + Send>>;
type ResumeFuture = Pin<Box<dyn Future<Output = Result<(), String>> + Send>>;
type RefreshFuture = Pin<Box<dyn Future<Output = ()> + Send>>;
type DelayFuture = Pin<Box<dyn Future<Output = ()> + Send>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum SleepPrepareOutcome {
    Ready { suspension_id: String },
    Busy,
}

struct HeldSuspension {
    id: String,
    route: String,
}

#[derive(Default)]
struct CycleState {
    suspension: Option<HeldSuspension>,
    generation: u64,
}

pub(crate) struct GatewaySleepCycleController {
    request_id: String,
    current_route: Arc<dyn Fn() -> Option<String> + Send + Sync>,
    prepare: Arc<dyn Fn(String) -> PrepareFuture + Send + Sync>,
    resume: Arc<dyn Fn(String) -> ResumeFuture + Send + Sync>,
    refresh: Arc<dyn Fn() -> RefreshFuture + Send + Sync>,
    retry_delay: Arc<dyn Fn(Duration) -> DelayFuture + Send + Sync>,
    log: Arc<dyn Fn(String) + Send + Sync>,
    state: Mutex<CycleState>,
}

impl GatewaySleepCycleController {
    pub(crate) fn new<P, PF, R, RF, F, FF, C, D, DF, L>(
        request_id: String,
        current_route: C,
        prepare: P,
        resume: R,
        refresh: F,
        retry_delay: D,
        log: L,
    ) -> Self
    where
        P: Fn(String) -> PF + Send + Sync + 'static,
        PF: Future<Output = Result<SleepPrepareOutcome, String>> + Send + 'static,
        R: Fn(String) -> RF + Send + Sync + 'static,
        RF: Future<Output = Result<(), String>> + Send + 'static,
        F: Fn() -> FF + Send + Sync + 'static,
        FF: Future<Output = ()> + Send + 'static,
        C: Fn() -> Option<String> + Send + Sync + 'static,
        D: Fn(Duration) -> DF + Send + Sync + 'static,
        DF: Future<Output = ()> + Send + 'static,
        L: Fn(String) + Send + Sync + 'static,
    {
        Self {
            request_id,
            current_route: Arc::new(current_route),
            prepare: Arc::new(move |request_id| Box::pin(prepare(request_id))),
            resume: Arc::new(move |suspension_id| Box::pin(resume(suspension_id))),
            refresh: Arc::new(move || Box::pin(refresh())),
            retry_delay: Arc::new(move |delay| Box::pin(retry_delay(delay))),
            log: Arc::new(log),
            state: Mutex::new(CycleState::default()),
        }
    }

    pub(crate) async fn will_sleep(&self) {
        // The production route closure exposes only configured loopback gateways.
        let Some(route) = (self.current_route)() else {
            return;
        };
        let generation = {
            let mut state = self
                .state
                .lock()
                .expect("gateway sleep state mutex poisoned");
            state.generation = state.generation.wrapping_add(1);
            state.generation
        };
        match (self.prepare)(self.request_id.clone()).await {
            Ok(SleepPrepareOutcome::Ready { suspension_id }) => {
                let late = {
                    let mut state = self
                        .state
                        .lock()
                        .expect("gateway sleep state mutex poisoned");
                    if generation == state.generation {
                        state.suspension = Some(HeldSuspension {
                            id: suspension_id.clone(),
                            route,
                        });
                        false
                    } else {
                        true
                    }
                };
                if late {
                    // Wake or a newer cycle won the race; do not leave the late lease active.
                    if let Err(error) = (self.resume)(suspension_id).await {
                        (self.log)(format!("gateway sleep preparation failed: {error}"));
                    }
                }
            }
            Ok(SleepPrepareOutcome::Busy) => {
                (self.log)("gateway sleep preparation skipped because the gateway is busy".into());
            }
            Err(error) => {
                (self.log)(format!("gateway sleep preparation failed: {error}"));
            }
        }
    }

    pub(crate) async fn did_wake(&self) {
        // Clear first so a second wake or failed resume cannot reuse this cycle's lease.
        let (suspension, generation) = {
            let mut state = self
                .state
                .lock()
                .expect("gateway sleep state mutex poisoned");
            let suspension = state.suspension.take();
            state.generation = state.generation.wrapping_add(1);
            (suspension, state.generation)
        };
        if (self.current_route)().is_none() {
            if suspension.is_some() {
                (self.log)(
                    "dropping gateway sleep lease: route/mode changed across sleep; lease will self-expire"
                        .into(),
                );
            }
            return;
        }

        // The pre-sleep transport is normally dead; reconnect before attempting resume.
        (self.refresh)().await;
        if let Some(suspension) = suspension {
            if (self.current_route)().as_ref() == Some(&suspension.route) {
                self.resume_with_retries(suspension.id, generation).await;
            } else {
                (self.log)(
                    "dropping gateway sleep lease: route/mode changed across sleep; lease will self-expire"
                        .into(),
                );
            }
        }
    }

    /// Hand back a lease we are still holding, because colai is closing.
    ///
    /// A suspension is a lease on somebody else's Gateway, and only `did_wake` gives it
    /// back. Quitting between the two — the machine never actually slept, or the app was
    /// closed mid-cycle — used to abandon it: the Gateway stayed suspended, closing every
    /// socket with "closed due to suspension", and nothing left running knew to resume
    /// it. From the outside that is OpenClaw dead with its process still up.
    ///
    /// One attempt, no retries. This runs while the app is exiting, and a resume that
    /// needs three tries and six seconds will not get them.
    pub(crate) async fn release_on_exit(&self) {
        let suspension = {
            let mut state = self
                .state
                .lock()
                .expect("gateway sleep state mutex poisoned");
            // Bump the generation so an in-flight `will_sleep` treats its own lease as
            // late and hands that one back itself, rather than storing it after we have
            // stopped looking.
            state.generation = state.generation.wrapping_add(1);
            state.suspension.take()
        };
        let Some(suspension) = suspension else {
            return;
        };
        if let Err(error) = (self.resume)(suspension.id).await {
            (self.log)(format!(
                "could not hand back the gateway sleep lease: {error}"
            ));
        }
    }

    /// Give the lease back if the sleep we prepared for never arrived.
    ///
    /// `will_sleep` takes a lease and only `did_wake` gives it back, so a `PrepareForSleep`
    /// with no matching wake strands the Gateway: process alive, every socket closed with
    /// "closed due to suspension", and nothing running that knows to undo it. That is not
    /// hypothetical — it happened here with the journal showing the machine never slept.
    ///
    /// The clock is what makes this safe. Monotonic time stops while a host is suspended,
    /// so waiting on it cannot expire during a genuine sleep however long it lasts; the
    /// delay only elapses if we are still awake, which is exactly the case being caught.
    ///
    /// Spawned by the caller, never awaited by it: the listener releases logind's delay
    /// inhibitor right after preparing, and blocking here would hold up every real
    /// suspend by a minute.
    pub(crate) async fn watch_for_a_sleep_that_never_came(&self) {
        let generation = self
            .state
            .lock()
            .expect("gateway sleep state mutex poisoned")
            .generation;
        (self.retry_delay)(AWAKE_AFTER_PREPARING).await;
        let suspension = {
            let mut state = self
                .state
                .lock()
                .expect("gateway sleep state mutex poisoned");
            // A wake, a newer cycle, or quitting already dealt with this one.
            if state.generation != generation {
                return;
            }
            state.generation = state.generation.wrapping_add(1);
            state.suspension.take()
        };
        let Some(suspension) = suspension else {
            return;
        };
        (self.log)("the host never slept; handing the gateway sleep lease back".into());
        if let Err(error) = (self.resume)(suspension.id).await {
            (self.log)(format!(
                "could not hand back the stale sleep lease: {error}"
            ));
        }
    }

    async fn resume_with_retries(&self, suspension_id: String, generation: u64) {
        for attempt in 1..=RESUME_ATTEMPTS {
            // A new sleep cycle owns the connection; abandoned leases self-expire.
            if generation
                != self
                    .state
                    .lock()
                    .expect("gateway sleep state mutex poisoned")
                    .generation
            {
                return;
            }
            match (self.resume)(suspension_id.clone()).await {
                Ok(()) => return,
                Err(error) => {
                    (self.log)(format!(
                        "gateway wake resume attempt {attempt} failed: {error}"
                    ));
                    if attempt < RESUME_ATTEMPTS {
                        (self.retry_delay)(RESUME_RETRY_DELAY).await;
                    }
                }
            }
        }
        (self.log)("giving up on gateway wake resume; lease will self-expire".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::oneshot;

    fn route_state(value: Option<&str>) -> Arc<Mutex<Option<String>>> {
        Arc::new(Mutex::new(value.map(str::to_string)))
    }

    fn current_route(
        route: &Arc<Mutex<Option<String>>>,
    ) -> impl Fn() -> Option<String> + Send + Sync + 'static {
        let route = Arc::clone(route);
        move || route.lock().expect("route mutex poisoned").clone()
    }

    fn no_delay(_: Duration) -> impl Future<Output = ()> + Send {
        std::future::ready(())
    }

    #[tokio::test]
    async fn a_sleep_that_never_arrives_gives_the_lease_back() {
        /*
         * Observed here: logind announced a sleep, the Gateway was suspended, and the
         * journal showed the host never actually slept. No wake ever came, so the lease
         * was held for ever — Gateway process alive, every socket closed with "closed due
         * to suspension", nothing running that knew to undo it.
         */
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let resumed = Arc::new(Mutex::new(Vec::new()));
        let noted = Arc::clone(&resumed);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-watchdog".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "stranded".into(),
                })
            },
            move |suspension_id: String| {
                noted.lock().unwrap().push(suspension_id);
                async { Ok(()) }
            },
            || async {},
            no_delay,
            |_| {},
        );

        controller.will_sleep().await;
        assert!(
            resumed.lock().unwrap().is_empty(),
            "nothing to give back yet"
        );

        controller.watch_for_a_sleep_that_never_came().await;
        assert_eq!(
            resumed.lock().unwrap().as_slice(),
            ["stranded"],
            "still awake, so the sleep did not happen and the lease goes back"
        );
    }

    #[tokio::test]
    async fn a_real_sleep_and_wake_leaves_the_watchdog_nothing_to_do() {
        // The ordinary path, and the one that must not double-resume. A wake bumps the
        // generation, so a watchdog still in flight from that cycle finds the lease is no
        // longer its business and says nothing to the Gateway.
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let resumed = Arc::new(Mutex::new(Vec::new()));
        let noted = Arc::clone(&resumed);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-real".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "slept".into(),
                })
            },
            move |suspension_id: String| {
                noted.lock().unwrap().push(suspension_id);
                async { Ok(()) }
            },
            || async {},
            no_delay,
            |_| {},
        );

        controller.will_sleep().await;
        controller.did_wake().await;
        assert_eq!(
            resumed.lock().unwrap().as_slice(),
            ["slept"],
            "wake resumed it"
        );

        controller.watch_for_a_sleep_that_never_came().await;
        assert_eq!(
            resumed.lock().unwrap().len(),
            1,
            "the watchdog must not resume a lease the wake already handed back"
        );
    }

    #[tokio::test]
    async fn a_watchdog_from_an_earlier_cycle_leaves_the_current_lease_alone() {
        /*
         * Sleep, wake, sleep again quickly — a lid closed and reopened, or a suspend
         * logind retries. The first cycle's watchdog is still counting when the second
         * takes a fresh lease, and without the generation check it would wake up and hand
         * back a lease that is currently in use, un-suspending a Gateway that is meant to
         * be asleep.
         *
         * The wait is a gate rather than a clock: the whole question is what happens
         * while one task waits and another runs, and holding that still beats timing it.
         */
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let leases = Arc::new(Mutex::new(0_usize));
        let issuing = Arc::clone(&leases);
        let resumed = Arc::new(Mutex::new(Vec::new()));
        let noted = Arc::clone(&resumed);
        let gate = Arc::new(tokio::sync::Notify::new());
        let waiting = Arc::clone(&gate);
        let controller = Arc::new(GatewaySleepCycleController::new(
            "linux-sleep-overlap".into(),
            current_route(&route),
            move |_| {
                let suspension_id = {
                    let mut count = issuing.lock().unwrap();
                    *count += 1;
                    format!("lease-{count}")
                };
                async move { Ok(SleepPrepareOutcome::Ready { suspension_id }) }
            },
            move |suspension_id: String| {
                noted.lock().unwrap().push(suspension_id);
                async { Ok(()) }
            },
            || async {},
            move |_| {
                let gate = Arc::clone(&waiting);
                async move { gate.notified().await }
            },
            |_| {},
        ));

        // First cycle, and its watchdog starts counting.
        controller.will_sleep().await;
        let watching = Arc::clone(&controller);
        let watchdog = tokio::spawn(async move {
            watching.watch_for_a_sleep_that_never_came().await;
        });
        // Let the watchdog reach the gate before anything else moves.
        tokio::task::yield_now().await;

        // Woke, and went straight back to sleep: a second lease is now the live one.
        controller.did_wake().await;
        controller.will_sleep().await;
        assert_eq!(
            resumed.lock().unwrap().as_slice(),
            ["lease-1"],
            "the wake resumed the first"
        );

        // Now let the first cycle's watchdog come due.
        gate.notify_one();
        watchdog.await.expect("watchdog task");

        assert_eq!(
            resumed.lock().unwrap().as_slice(),
            ["lease-1"],
            "the stale watchdog must not hand back the lease the current sleep is holding"
        );
    }

    #[tokio::test]
    async fn quitting_hands_back_a_suspension_it_is_still_holding() {
        /*
         * The bug this is about: the Gateway alive with every socket closed, saying
         * "WebSocket is closed due to suspension", and nothing running that knows how to
         * undo it.
         *
         * A suspension is a lease on somebody else's Gateway, and only `did_wake` gave it
         * back. Quitting between the two halves — the machine never actually slept, or
         * colai was closed mid-cycle — abandoned it, and the lease outlived the process
         * that took it.
         */
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let resumed = Arc::new(Mutex::new(Vec::new()));
        let noted = Arc::clone(&resumed);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-exit".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "suspension-held".into(),
                })
            },
            move |suspension_id: String| {
                noted.lock().unwrap().push(suspension_id);
                async { Ok(()) }
            },
            || async {},
            no_delay,
            |_| {},
        );

        controller.will_sleep().await;
        assert!(
            resumed.lock().unwrap().is_empty(),
            "still asleep, nothing to give back yet"
        );

        controller.release_on_exit().await;
        assert_eq!(
            resumed.lock().unwrap().as_slice(),
            ["suspension-held"],
            "the lease has to go back on the way out"
        );

        // And only once: a second quit, or a wake that arrives after it, must not resume
        // a lease that is no longer ours.
        controller.release_on_exit().await;
        controller.did_wake().await;
        assert_eq!(resumed.lock().unwrap().len(), 1, "handed back exactly once");
    }

    #[tokio::test]
    async fn quitting_with_nothing_held_asks_the_gateway_for_nothing() {
        // Every ordinary quit takes this path. Sending a resume for a lease that was
        // never taken would be colai talking about a sleep that never happened.
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let resumed = Arc::new(Mutex::new(Vec::new()));
        let noted = Arc::clone(&resumed);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-exit-idle".into(),
            current_route(&route),
            |_| async { Ok(SleepPrepareOutcome::Busy) },
            move |suspension_id: String| {
                noted.lock().unwrap().push(suspension_id);
                async { Ok(()) }
            },
            || async {},
            no_delay,
            |_| {},
        );

        controller.release_on_exit().await;
        assert!(resumed.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn ready_preparation_resumes_once_after_refresh() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let events = Arc::new(Mutex::new(Vec::new()));
        let prepare_events = Arc::clone(&events);
        let resume_events = Arc::clone(&events);
        let refresh_events = Arc::clone(&events);
        let request_ids = Arc::new(Mutex::new(Vec::new()));
        let prepared_ids = Arc::clone(&request_ids);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            move |request_id| {
                prepared_ids.lock().unwrap().push(request_id);
                prepare_events.lock().unwrap().push("prepare");
                async {
                    Ok(SleepPrepareOutcome::Ready {
                        suspension_id: "suspension-1".into(),
                    })
                }
            },
            move |_| {
                resume_events.lock().unwrap().push("resume");
                async { Ok(()) }
            },
            move || {
                refresh_events.lock().unwrap().push("refresh");
                async {}
            },
            no_delay,
            |_| {},
        );

        controller.will_sleep().await;
        controller.did_wake().await;
        controller.did_wake().await;

        assert_eq!(*request_ids.lock().unwrap(), ["linux-sleep-test-run"]);
        assert_eq!(
            *events.lock().unwrap(),
            ["prepare", "refresh", "resume", "refresh"]
        );
    }

    #[tokio::test]
    async fn busy_preparation_does_not_resume() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let resumes = Arc::new(AtomicUsize::new(0));
        let resumed = Arc::clone(&resumes);
        let refreshes = Arc::new(AtomicUsize::new(0));
        let refreshed = Arc::clone(&refreshes);
        let logs = Arc::new(Mutex::new(Vec::new()));
        let recorded_logs = Arc::clone(&logs);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            |_| async { Ok(SleepPrepareOutcome::Busy) },
            move |_| {
                resumed.fetch_add(1, Ordering::SeqCst);
                async { Ok(()) }
            },
            move || {
                refreshed.fetch_add(1, Ordering::SeqCst);
                async {}
            },
            no_delay,
            move |message| recorded_logs.lock().unwrap().push(message),
        );

        controller.will_sleep().await;
        controller.did_wake().await;

        assert_eq!(resumes.load(Ordering::SeqCst), 0);
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(
            *logs.lock().unwrap(),
            ["gateway sleep preparation skipped because the gateway is busy"]
        );
    }

    #[tokio::test]
    async fn failed_preparation_does_not_resume() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let resumes = Arc::new(AtomicUsize::new(0));
        let resumed = Arc::clone(&resumes);
        let refreshes = Arc::new(AtomicUsize::new(0));
        let refreshed = Arc::clone(&refreshes);
        let logs = Arc::new(Mutex::new(Vec::new()));
        let recorded_logs = Arc::clone(&logs);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            |_| async { Err("prepare failed".into()) },
            move |_| {
                resumed.fetch_add(1, Ordering::SeqCst);
                async { Ok(()) }
            },
            move || {
                refreshed.fetch_add(1, Ordering::SeqCst);
                async {}
            },
            no_delay,
            move |message| recorded_logs.lock().unwrap().push(message),
        );

        controller.will_sleep().await;
        controller.did_wake().await;

        assert_eq!(resumes.load(Ordering::SeqCst), 0);
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(
            *logs.lock().unwrap(),
            ["gateway sleep preparation failed: prepare failed"]
        );
    }

    #[tokio::test]
    async fn changed_route_drops_the_suspension() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let resumes = Arc::new(AtomicUsize::new(0));
        let resumed = Arc::clone(&resumes);
        let logs = Arc::new(Mutex::new(Vec::new()));
        let recorded_logs = Arc::clone(&logs);
        let refreshes = Arc::new(AtomicUsize::new(0));
        let refreshed = Arc::clone(&refreshes);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "suspension-1".into(),
                })
            },
            move |_| {
                resumed.fetch_add(1, Ordering::SeqCst);
                async { Ok(()) }
            },
            move || {
                refreshed.fetch_add(1, Ordering::SeqCst);
                async {}
            },
            no_delay,
            move |message| recorded_logs.lock().unwrap().push(message),
        );

        controller.will_sleep().await;
        *route.lock().unwrap() = Some("ws://127.0.0.1:19001".into());
        controller.did_wake().await;

        assert_eq!(resumes.load(Ordering::SeqCst), 0);
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(
            *logs.lock().unwrap(),
            ["dropping gateway sleep lease: route/mode changed across sleep; lease will self-expire"]
        );
    }

    #[tokio::test]
    async fn missing_or_remote_route_drops_a_held_suspension() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let resumes = Arc::new(AtomicUsize::new(0));
        let resumed = Arc::clone(&resumes);
        let refreshes = Arc::new(AtomicUsize::new(0));
        let refreshed = Arc::clone(&refreshes);
        let logs = Arc::new(Mutex::new(Vec::new()));
        let recorded_logs = Arc::clone(&logs);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "suspension-1".into(),
                })
            },
            move |_| {
                resumed.fetch_add(1, Ordering::SeqCst);
                async { Ok(()) }
            },
            move || {
                refreshed.fetch_add(1, Ordering::SeqCst);
                async {}
            },
            no_delay,
            move |message| recorded_logs.lock().unwrap().push(message),
        );

        controller.will_sleep().await;
        *route.lock().unwrap() = None;
        controller.did_wake().await;
        *route.lock().unwrap() = Some("ws://127.0.0.1:18789".into());
        controller.did_wake().await;

        assert_eq!(resumes.load(Ordering::SeqCst), 0);
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(logs.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn late_prepare_response_resumes_immediately() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let (release, receiver) = oneshot::channel();
        let (started, prepare_started) = oneshot::channel();
        let receiver = Arc::new(Mutex::new(Some(receiver)));
        let prepare_receiver = Arc::clone(&receiver);
        let started = Arc::new(Mutex::new(Some(started)));
        let prepare_started_sender = Arc::clone(&started);
        let resumed_ids = Arc::new(Mutex::new(Vec::new()));
        let resumed = Arc::clone(&resumed_ids);
        let controller = Arc::new(GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            move |_| {
                let receiver = prepare_receiver.lock().unwrap().take().unwrap();
                prepare_started_sender
                    .lock()
                    .unwrap()
                    .take()
                    .unwrap()
                    .send(())
                    .unwrap();
                async move {
                    let _ = receiver.await;
                    Ok(SleepPrepareOutcome::Ready {
                        suspension_id: "late-suspension".into(),
                    })
                }
            },
            move |id| {
                resumed.lock().unwrap().push(id);
                async { Ok(()) }
            },
            || async {},
            no_delay,
            |_| {},
        ));

        let sleeping = {
            let controller = Arc::clone(&controller);
            tokio::spawn(async move { controller.will_sleep().await })
        };
        prepare_started.await.unwrap();
        controller.did_wake().await;
        release.send(()).unwrap();
        sleeping.await.unwrap();
        controller.did_wake().await;

        assert_eq!(*resumed_ids.lock().unwrap(), ["late-suspension"]);
    }

    #[tokio::test]
    async fn resume_retries_then_succeeds() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempted = Arc::clone(&attempts);
        let delays = Arc::new(AtomicUsize::new(0));
        let delayed = Arc::clone(&delays);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "suspension-retry".into(),
                })
            },
            move |_| {
                let attempt = attempted.fetch_add(1, Ordering::SeqCst);
                async move {
                    if attempt == 0 {
                        Err("transport failed".into())
                    } else {
                        Ok(())
                    }
                }
            },
            || async {},
            move |_| {
                delayed.fetch_add(1, Ordering::SeqCst);
                async {}
            },
            |_| {},
        );

        controller.will_sleep().await;
        controller.did_wake().await;

        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert_eq!(delays.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn resume_exhausts_three_attempts() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempted = Arc::clone(&attempts);
        let logs = Arc::new(Mutex::new(Vec::new()));
        let recorded_logs = Arc::clone(&logs);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "suspension-exhaust".into(),
                })
            },
            move |_| {
                attempted.fetch_add(1, Ordering::SeqCst);
                async { Err("transport failed".into()) }
            },
            || async {},
            no_delay,
            move |message| recorded_logs.lock().unwrap().push(message),
        );

        controller.will_sleep().await;
        controller.did_wake().await;

        assert_eq!(attempts.load(Ordering::SeqCst), 3);
        assert!(logs
            .lock()
            .unwrap()
            .iter()
            .any(|log| log.contains("giving up")));
    }

    #[tokio::test]
    async fn new_sleep_cycle_aborts_in_flight_retries() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempted = Arc::clone(&attempts);
        let controller_slot = Arc::new(Mutex::new(None::<Arc<GatewaySleepCycleController>>));
        let delay_slot = Arc::clone(&controller_slot);
        let controller = Arc::new(GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "suspension-abort".into(),
                })
            },
            move |_| {
                attempted.fetch_add(1, Ordering::SeqCst);
                async { Err("transport failed".into()) }
            },
            || async {},
            move |_| {
                let controller = delay_slot.lock().unwrap().as_ref().unwrap().clone();
                async move { controller.will_sleep().await }
            },
            |_| {},
        ));
        *controller_slot.lock().unwrap() = Some(Arc::clone(&controller));

        controller.will_sleep().await;
        controller.did_wake().await;

        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn wake_always_clears_the_held_lease() {
        let route = route_state(Some("ws://127.0.0.1:18789"));
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempted = Arc::clone(&attempts);
        let controller = GatewaySleepCycleController::new(
            "linux-sleep-test-run".into(),
            current_route(&route),
            |_| async {
                Ok(SleepPrepareOutcome::Ready {
                    suspension_id: "suspension-failure".into(),
                })
            },
            move |_| {
                attempted.fetch_add(1, Ordering::SeqCst);
                async { Err("transport failed".into()) }
            },
            || async {},
            no_delay,
            |_| {},
        );

        controller.will_sleep().await;
        controller.did_wake().await;
        controller.did_wake().await;

        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }
}
