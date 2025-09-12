use std::sync::Arc;

use tokio::sync::mpsc;
use tokio::sync::mpsc::error::SendTimeoutError;
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub enum StatusInfo {
    HEALTH {
        status: String,
        message: String,
    },
    SHUTDOWN {
        status: String,
        message: String,
    },
    RESPONSE {
        path: String,
        content_type: String,
        content: String,
    },
    REQUEST {
        path: String,
        content_type: String,
        content: String,
    },
}

#[derive(Debug, Clone)]
pub struct Master<T>
where
    T: Clone,
{
    pub tx: mpsc::Sender<T>,
    pub rx: Arc<Mutex<mpsc::Receiver<T>>>,
}

impl<T> Master<T>
where
    T: Clone,
{
    pub async fn send(&self, message: T) -> Result<(), mpsc::error::SendError<T>> {
        self.tx.send(message).await
    }
    pub async fn recv(&mut self) -> Option<T> {
        let mut rx = self.rx.lock().await;

        rx.recv().await
    }
    pub async fn send_timeout(
        &self,
        message: T,
        timeout: u64,
    ) -> Result<(), mpsc::error::SendTimeoutError<T>> {
        self.tx
            .send_timeout(message, tokio::time::Duration::from_millis(timeout))
            .await
    }
}

#[derive(Debug, Clone)]
pub struct Slave<T>
where
    T: Clone,
{
    pub tx: mpsc::Sender<T>,
    pub rx: Arc<Mutex<mpsc::Receiver<T>>>,
}

impl<T> Slave<T>
where
    T: Clone,
{
    pub async fn send(&self, message: T) -> Result<(), mpsc::error::SendError<T>> {
        self.tx.send(message).await
    }
    pub async fn recv(&mut self) -> Option<T> {
        let mut rx = self.rx.lock().await;

        rx.recv().await
    }
    pub async fn send_timeout(&self, message: T, timeout: u64) -> Result<(), SendTimeoutError<T>> {
        self.tx
            .send_timeout(message, tokio::time::Duration::from_millis(timeout))
            .await
    }
}

#[derive(Debug)]
pub struct BidirectionalChannel<T>
where
    T: Clone,
{
    pub master: Master<T>,
    pub slave: Slave<T>,
}

impl<T> BidirectionalChannel<T>
where
    T: Clone,
{
    pub fn new(buffer: usize) -> Self {
        let (master_tx, slave_rx) = mpsc::channel::<T>(buffer);
        let (slave_tx, master_rx) = mpsc::channel::<T>(buffer);
        let master = Master {
            tx: master_tx,
            rx: Arc::new(Mutex::new(master_rx)),
        };
        let slave = Slave {
            tx: slave_tx,
            rx: Arc::new(Mutex::new(slave_rx)),
        };
        BidirectionalChannel { master, slave }
    }
    pub fn clone_master(&self) -> Master<T> {
        Master {
            tx: self.master.tx.clone(),
            rx: self.master.rx.clone(),
        }
    }
    pub fn clone_slave(&self) -> Slave<T> {
        Slave {
            tx: self.slave.tx.clone(),
            rx: self.slave.rx.clone(),
        }
    }
    pub async fn clean_buffer(&mut self) {
        loop {
            tokio::select! {
                _ = self.slave.recv() => {},
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(200)) => {
                    break;
                },
            }
            tokio::select! {
                _ = self.master.recv() => {},
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(200)) => {
                    break;
                },
            }
        }
    }
}

pub async fn check_health(
    mut master: Master<StatusInfo>,
) -> Result<(), SendTimeoutError<StatusInfo>> {
    match master
        .send_timeout(
            StatusInfo::HEALTH {
                status: "RUNNING".to_string(),
                message: "".to_string(),
            },
            2000,
        )
        .await
    {
        Ok(_) => {
            tracing::info!("Sent health message");
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(2000)) => {
                    return Err(
                        SendTimeoutError::<StatusInfo>::Timeout(
                            StatusInfo::HEALTH {
                                status: "ERROR".to_string(),
                                message: "Health check failed with timeout".to_string(),
                            }
                        )
                    );
                },
                _ = master.recv() => {
                    return Ok(());
                },
            }
        }
        Err(e) => {
            tracing::error!("Error sending health message: {}", e);
            return Err(e);
        }
    }
}

pub async fn request_shutdown(
    mut master: Master<StatusInfo>,
) -> Result<(), SendTimeoutError<StatusInfo>> {
    match master
        .send_timeout(
            StatusInfo::SHUTDOWN {
                status: "SHUTTING DOWN".to_string(),
                message: "".to_string(),
            },
            2000,
        )
        .await
    {
        Ok(_) => {
            tracing::info!("Sent shutdown message");
            tokio::select! {
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(2000)) => {
                    return Err(SendTimeoutError::<StatusInfo>::Timeout(
                        StatusInfo::SHUTDOWN {
                            status: "ERROR".to_string(),
                            message: "Shutdown failed with timeout".to_string(),
                        }
                    ));
                },
                _ = master.recv() => {
                    return Ok(());
                },
            }
        }
        Err(e) => {
            tracing::error!("Error sending shutdown message: {}", e);
            return Err(e);
        }
    }
}
