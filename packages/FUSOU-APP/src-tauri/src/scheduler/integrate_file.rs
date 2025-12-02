use crate::builder_setup::bidirectional_channel::get_scheduler_integrate_bidirectional_channel;
use crate::storage::integrate;
use proxy_https::{bidirectional_channel, proxy_server_https::setup_default_crypto_provider};
use tokio_cron_scheduler::{JobBuilder, JobScheduler};
use fusou_upload::{PendingStore, UploadRetryService};
use std::sync::Arc;

pub fn start_scheduler(
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>
) {
    let configs = configs::get_user_configs_for_app();
    let scheduler_cron = configs.database.google_drive.get_schedule_cron();
    
    let pending_store_clone = pending_store.clone();
    let retry_service_clone = retry_service.clone();

    tokio::spawn(async move {
        let pending_store_for_job = pending_store_clone.clone();
        let retry_service_for_job = retry_service_clone.clone();

        let job = match JobBuilder::new()
            .with_timezone(chrono_tz::Asia::Tokyo)
            .with_cron_job_type()
            .with_schedule(&scheduler_cron)
        {
            Ok(builder) => match builder
                .with_run_async(Box::new(move |uuid, mut l| {
                    let pending_store = pending_store_for_job.clone();
                    let retry_service = retry_service_for_job.clone();
                    Box::pin(async move {
                        let next_tick = l.next_tick_for_job(uuid).await;
                        match next_tick {
                            Ok(Some(ts)) => {
                                tracing::info!("Google Drive sync job running at {:?}", ts);
                                integrate::integrate_port_table(pending_store, retry_service);
                            }
                            _ => {
                                tracing::warn!("Could not get next tick for Google Drive sync job")
                            }
                        }
                    })
                }))
                .build()
            {
                Ok(job) => job,
                Err(e) => {
                    tracing::error!("Failed to build job: {}", e);
                    return;
                }
            },
            Err(e) => {
                tracing::error!("Failed to create job builder: {}", e);
                return;
            }
        };

        let sched = match JobScheduler::new().await {
            Ok(sched) => sched,
            Err(e) => {
                tracing::error!("Failed to create new JobScheduler: {}", e);
                return;
            }
        };
        if let Err(e) = sched.add(job).await {
            tracing::error!("Failed to add job to scheduler: {}", e);
        }
        if let Err(e) = sched.start().await {
            tracing::error!("Failed to start scheduler: {}", e);
        }

        // Is this necessary?
        setup_default_crypto_provider();

        let mut slave = get_scheduler_integrate_bidirectional_channel().clone_slave();
        loop {
            tokio::select! {
                recv_msg = slave.recv() => {
                    match recv_msg {
                        None => {
                            tracing::warn!("Received None message");
                        },
                        Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                            tracing::info!("Received shutdown message: {} {}", status, message);
                            let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                                status: "SHUTTING DOWN".to_string(),
                                message: "Integrate scheduler is shutting down".to_string(),
                            }).await;
                            break;
                        },
                        Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                            tracing::info!("Received health message: {} {}", status, message);
                            let _ = slave.send(bidirectional_channel::StatusInfo::HEALTH {
                                status: "RUNNING".to_string(),
                                message: "Integrate scheduler is running".to_string(),
                            }).await;
                        },
                        _ => {}
                    }
                },
                _ = tokio::signal::ctrl_c() => {
                    break;
                },
            }
        }
    });
}
