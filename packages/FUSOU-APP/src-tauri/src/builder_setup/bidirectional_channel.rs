use once_cell::sync::OnceCell;
use proxy_https::bidirectional_channel::{BidirectionalChannel, StatusInfo};
use proxy_https::bidirectional_channel::{Master, Slave};

#[cfg(feature = "auth-local-server")]
use crate::auth_server;

static PROXY_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> = OnceCell::new();

static PAC_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> = OnceCell::new();

static PROXY_LOG_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> =
    OnceCell::new();

static RESPONSE_PARSE_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> =
    OnceCell::new();

static SCHEDULER_INTEGRATE_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> =
    OnceCell::new();

#[cfg(feature = "auth-local-server")]
static AUTH_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> = OnceCell::new();

pub fn get_proxy_bidirectional_channel() -> &'static BidirectionalChannel<StatusInfo> {
    PROXY_BIDIRECTIONAL_CHANNEL.get_or_init(|| BidirectionalChannel::<StatusInfo>::new(1))
}

pub fn get_pac_bidirectional_channel() -> &'static BidirectionalChannel<StatusInfo> {
    PAC_BIDIRECTIONAL_CHANNEL.get_or_init(|| BidirectionalChannel::<StatusInfo>::new(1))
}

pub fn get_proxy_log_bidirectional_channel() -> &'static BidirectionalChannel<StatusInfo> {
    PROXY_LOG_BIDIRECTIONAL_CHANNEL.get_or_init(|| BidirectionalChannel::<StatusInfo>::new(1))
}

pub fn get_response_parse_bidirectional_channel() -> &'static BidirectionalChannel<StatusInfo> {
    RESPONSE_PARSE_BIDIRECTIONAL_CHANNEL.get_or_init(|| BidirectionalChannel::<StatusInfo>::new(1))
}

pub fn get_scheduler_integrate_bidirectional_channel() -> &'static BidirectionalChannel<StatusInfo>
{
    SCHEDULER_INTEGRATE_BIDIRECTIONAL_CHANNEL
        .get_or_init(|| BidirectionalChannel::<StatusInfo>::new(1))
}

#[cfg(feature = "auth-local-server")]
pub fn get_auth_bidirectional_channel() -> &'static BidirectionalChannel<StatusInfo> {
    AUTH_BIDIRECTIONAL_CHANNEL.get_or_init(|| BidirectionalChannel::<StatusInfo>::new(1))
}

#[allow(dead_code)]
pub struct PacChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

#[allow(dead_code)]
pub struct ProxyChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

#[allow(dead_code)]
pub struct ProxyLogChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

#[allow(dead_code)]
pub struct ResponseParseChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

#[allow(dead_code)]
pub struct SchedulerIntegrateChannel {
    pub master: Master<StatusInfo>,
    pub slave: Slave<StatusInfo>,
}

#[allow(dead_code)]
pub fn get_manage_proxy_channel() -> ProxyChannel {
    ProxyChannel {
        master: get_proxy_bidirectional_channel().clone_master(),
        slave: get_proxy_bidirectional_channel().clone_slave(),
    }
}

#[allow(dead_code)]
pub fn get_manage_pac_channel() -> PacChannel {
    PacChannel {
        master: get_pac_bidirectional_channel().clone_master(),
        slave: get_pac_bidirectional_channel().clone_slave(),
    }
}

#[allow(dead_code)]
pub fn get_manage_proxy_log_channel() -> ProxyLogChannel {
    ProxyLogChannel {
        master: get_proxy_log_bidirectional_channel().clone_master(),
        slave: get_proxy_log_bidirectional_channel().clone_slave(),
    }
}

#[allow(dead_code)]
pub fn get_manage_response_parse_channel() -> ResponseParseChannel {
    ResponseParseChannel {
        master: get_response_parse_bidirectional_channel().clone_master(),
        slave: get_response_parse_bidirectional_channel().clone_slave(),
    }
}

#[allow(dead_code)]
pub fn get_manage_scheduler_integrate_channel() -> SchedulerIntegrateChannel {
    SchedulerIntegrateChannel {
        master: get_scheduler_integrate_bidirectional_channel().clone_master(),
        slave: get_scheduler_integrate_bidirectional_channel().clone_slave(),
    }
}

#[cfg(feature = "auth-local-server")]
pub fn get_manage_auth_channel() -> auth_server::AuthChannel {
    auth_server::AuthChannel {
        // master: auth_bidirectional_channel_master.clone(),
        slave: auth_bidirectional_channel_slave.clone(),
    }
}
