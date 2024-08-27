use std::sync::Arc;

use tokio::sync::Mutex;
use tokio::sync::mpsc;

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
}

pub struct  Master<T> where T: Clone {
    pub tx: mpsc::Sender<T>,
    pub rx: Arc<Mutex<mpsc::Receiver<T>>>,
}


impl<T> Master<T> where T: Clone {
    pub async fn send(&self, message: T) -> Result<(), mpsc::error::SendError<T>> {
        self.tx.send(message).await
    }
    pub async fn recv(&mut self) -> Option<T> {
        let mut rx = self.rx.lock().await;
        
        rx.recv().await
    }
}

pub struct Slave<T> where T: Clone {
    pub tx: mpsc::Sender<T>,
    pub rx: Arc<Mutex<mpsc::Receiver<T>>>,
}

impl <T> Slave<T> where T: Clone {
    pub async fn send(&self, message: T) -> Result<(), mpsc::error::SendError<T>> {
        self.tx.send(message).await
    }
    pub async fn recv(&mut self) -> Option<T> {
        let mut rx = self.rx.lock().await;
        
        rx.recv().await
    }
    
}

pub struct BidirectionalChannel<T> where T: Clone {
    pub master: Master<T>,
    pub slave: Slave<T>,
}

impl<T> BidirectionalChannel<T> where T: Clone {
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
        BidirectionalChannel {
            master,
            slave,
        }
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
}