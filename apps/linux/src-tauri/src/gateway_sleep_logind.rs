use crate::gateway_sleep::GatewaySleepCycleController;
use crate::gateway_sleep_logind_listener::{run_listener, BeginSleepCycleHook, EndSleepCycleHook};
use crate::gateway_ws::GatewayClient;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

/// How long quitting will wait to hand a suspension back before giving up on it.
const RELEASE_ON_EXIT: std::time::Duration = std::time::Duration::from_secs(2);

pub(crate) struct SleepBridge {
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// Kept so closing colai can hand back a suspension it is still holding. Without a
    /// handle here, shutdown could only abort the listener — and an aborted listener
    /// never reaches the wake half of the cycle.
    controller: Arc<GatewaySleepCycleController>,
}

impl SleepBridge {
    pub(crate) fn start(app: AppHandle) -> Self {
        let gateway = app.state::<GatewayClient>().inner().clone();
        // The driver task stays parked outside Quick Chat or a sleep cycle, so starting it here
        // does not widen the companion's normal Gateway connection lifetime.
        gateway.activate(app.clone());
        let route_gateway = gateway.clone();
        let prepare_gateway = gateway.clone();
        let resume_gateway = gateway.clone();
        let refresh_gateway = gateway.clone();
        let begin_gateway = gateway.clone();
        let end_gateway = gateway;
        let controller = Arc::new(GatewaySleepCycleController::new(
            format!("linux-sleep-{}", Uuid::new_v4()),
            move || route_gateway.loopback_route_token(),
            move |request_id| {
                let gateway = prepare_gateway.clone();
                async move { gateway.suspend_prepare(request_id).await }
            },
            move |suspension_id| {
                let gateway = resume_gateway.clone();
                async move {
                    gateway.suspend_resume(suspension_id).await?;
                    Ok(())
                }
            },
            move || {
                refresh_gateway.resume_reconnect();
                async {}
            },
            tokio::time::sleep,
            |message| eprintln!("Gateway sleep: {message}"),
        ));
        let begin_sleep_cycle: BeginSleepCycleHook = Arc::new(move || {
            // A remote or unconfigured route must not activate the driver.
            if begin_gateway.loopback_route_token().is_none() {
                return false;
            }
            begin_gateway.begin_sleep_cycle();
            true
        });
        let end_sleep_cycle: EndSleepCycleHook = Arc::new(move || end_gateway.end_sleep_cycle());
        let listening = Arc::clone(&controller);
        let task = tauri::async_runtime::spawn(async move {
            if let Err(error) = run_listener(listening, begin_sleep_cycle, end_sleep_cycle).await {
                eprintln!("Gateway sleep listener unavailable: {error}");
            }
        });
        Self {
            task: Mutex::new(Some(task)),
            controller,
        }
    }

    /// Stop listening, and give back anything we were holding.
    ///
    /// The order matters. Aborting first stops the listener from starting another cycle
    /// underneath us; releasing second makes sure a lease taken before the abort is
    /// handed back rather than abandoned. Abandoning it leaves the Gateway suspended
    /// after colai has gone — its process still up, every socket closed, and nothing
    /// left running that knows how to resume it.
    pub(crate) fn shutdown(&self) {
        if let Some(task) = self
            .task
            .lock()
            .expect("sleep bridge mutex poisoned")
            .take()
        {
            task.abort();
        }
        // Bounded, because this runs on the way out: a Gateway that cannot be reached in
        // a couple of seconds is one whose lease will have to self-expire, and blocking
        // the quit any longer only makes colai look hung.
        let controller = Arc::clone(&self.controller);
        let _ = tauri::async_runtime::block_on(async move {
            tokio::time::timeout(RELEASE_ON_EXIT, controller.release_on_exit()).await
        });
    }
}
