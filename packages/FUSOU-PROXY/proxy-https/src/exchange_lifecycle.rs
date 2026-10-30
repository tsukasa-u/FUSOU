use std::{
    future::Future,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::time::{timeout, Instant};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

pub const EXCHANGE_TIMEOUT_ENV: &str = "FUSOU_TLSN_EXCHANGE_TIMEOUT_MS";
pub const CLEANUP_TIMEOUT_ENV: &str = "FUSOU_TLSN_CLEANUP_TIMEOUT_MS";
pub const NOTARY_ATTESTATION_LIMIT_ENV: &str = "FUSOU_TLSN_MAX_NOTARY_ATTESTATION_BYTES";

fn positive_integer(value: Option<&str>, name: &str, unit: &str) -> Result<u64, String> {
    let value = value.ok_or_else(|| format!("{name} must be explicitly configured"))?;
    let invalid = || format!("{name} must be canonical positive integer {unit}");
    if value.starts_with('0') || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(invalid());
    }
    value.parse::<u64>().map_err(|_| invalid())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NotaryAttestationLimit(usize);

impl NotaryAttestationLimit {
    pub fn from_bytes(value: Option<&str>) -> Result<Self, String> {
        let value = positive_integer(value, NOTARY_ATTESTATION_LIMIT_ENV, "bytes")?;
        let max_bytes = usize::try_from(value)
            .ok()
            .filter(|max| {
                max.checked_add(1)
                    .is_some_and(|sentinel| isize::try_from(sentinel).is_ok())
            })
            .ok_or_else(|| {
                format!("{NOTARY_ATTESTATION_LIMIT_ENV} is outside the supported buffer range")
            })?;
        Ok(Self(max_bytes))
    }

    pub fn max_bytes(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExchangePolicy {
    exchange: Duration,
    cleanup: Duration,
}

impl ExchangePolicy {
    pub fn from_millis(exchange: Option<&str>, cleanup: Option<&str>) -> Result<Self, String> {
        fn parse(value: Option<&str>, name: &str) -> Result<Duration, String> {
            let millis = positive_integer(value, name, "milliseconds")?;
            let duration = Duration::from_millis(millis);
            if duration.is_zero() || Instant::now().checked_add(duration).is_none() {
                return Err(format!("{name} is outside the supported timer range"));
            }
            Ok(duration)
        }
        Ok(Self {
            exchange: parse(exchange, EXCHANGE_TIMEOUT_ENV)?,
            cleanup: parse(cleanup, CLEANUP_TIMEOUT_ENV)?,
        })
    }

    pub fn start(self) -> Result<ExchangeLifecycle, String> {
        let deadline = Instant::now()
            .checked_add(self.exchange)
            .ok_or("TLSN exchange deadline is outside the supported timer range")?;
        Ok(ExchangeLifecycle {
            deadline,
            cleanup: self.cleanup,
            cancel: CancellationToken::new(),
            reason: Arc::new(AtomicU8::new(0)),
            tasks: TaskTracker::new(),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExchangeStop {
    Cancelled = 1,
    Deadline = 2,
}

impl std::fmt::Display for ExchangeStop {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Cancelled => "TLSN exchange cancelled; no upstream retry",
            Self::Deadline => "TLSN absolute exchange deadline exceeded; no upstream retry",
        })
    }
}

#[derive(Clone)]
pub struct ExchangeLifecycle {
    deadline: Instant,
    cleanup: Duration,
    cancel: CancellationToken,
    reason: Arc<AtomicU8>,
    tasks: TaskTracker,
}

impl ExchangeLifecycle {
    pub fn stop(&self, reason: ExchangeStop) -> ExchangeStop {
        let _ = self
            .reason
            .compare_exchange(0, reason as u8, Ordering::AcqRel, Ordering::Acquire);
        self.cancel.cancel();
        self.stop_reason()
            .expect("stop reason is stored before cancellation")
    }

    pub fn stop_reason(&self) -> Option<ExchangeStop> {
        match self.reason.load(Ordering::Acquire) {
            1 => Some(ExchangeStop::Cancelled),
            2 => Some(ExchangeStop::Deadline),
            _ => None,
        }
    }

    pub fn check(&self) -> Result<(), ExchangeStop> {
        if let Some(reason) = self.stop_reason() {
            return Err(reason);
        }
        if Instant::now() >= self.deadline {
            return Err(self.stop(ExchangeStop::Deadline));
        }
        Ok(())
    }

    pub async fn run<F: Future>(&self, future: F) -> Result<F::Output, ExchangeStop> {
        self.check()?;
        tokio::select! {
            biased;
            _ = self.cancel.cancelled() => Err(self.stop_reason().expect("owned cancellation reason")),
            _ = tokio::time::sleep_until(self.deadline) => Err(self.stop(ExchangeStop::Deadline)),
            result = future => { self.check()?; Ok(result) }
        }
    }

    pub(crate) fn tasks(&self) -> &TaskTracker {
        &self.tasks
    }

    pub(crate) async fn finish_local_io<F, T, E>(&self, future: F) -> Result<Result<T, E>, String>
    where
        F: Future<Output = Result<T, E>> + Send + 'static,
        T: Send + 'static,
        E: Send + 'static,
    {
        self.check().map_err(|reason| reason.to_string())?;
        // Dropping a Tokio filesystem future does not stop its blocking IO.
        // Once admitted, retain the whole local operation for cleanup instead.
        self.tasks
            .spawn(async move {
                let result = future.await;
                if result.is_err() {
                    tracing::warn!("TLSN owned local persistence failed");
                }
                result
            })
            .await
            .map_err(|error| {
                tracing::error!(%error, "TLSN local persistence task failed to join");
                "TLSN local persistence task failed to join".to_owned()
            })
    }

    pub async fn wait_for_cleanup(&self) -> bool {
        self.tasks.close();
        timeout(self.cleanup, self.tasks.wait()).await.is_ok()
    }
}

#[cfg(test)]
mod tests;
