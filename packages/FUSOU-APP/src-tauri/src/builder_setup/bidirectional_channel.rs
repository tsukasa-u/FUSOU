use once_cell::sync::OnceCell;
use proxy_https::bidirectional_channel::{BidirectionalChannel, StatusInfo};

use crate::wrap_proxy;

#[cfg(feature = "auth-local-server")]
use crate::auth_server;

static PROXY_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> = OnceCell::new();

static PAC_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> = OnceCell::new();

static PROXY_LOG_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> =
    OnceCell::new();

static RESPONSE_PARSE_BIDIRECTIONAL_CHANNEL: OnceCell<BidirectionalChannel<StatusInfo>> =
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

#[cfg(feature = "auth-local-server")]
pub fn get_auth_bidirectional_channel() -> &'static BidirectionalChannel<StatusInfo> {
    AUTH_BIDIRECTIONAL_CHANNEL.get_or_init(|| BidirectionalChannel::<StatusInfo>::new(1))
}

pub fn get_manage_proxy_channel() -> wrap_proxy::ProxyChannel {
    wrap_proxy::ProxyChannel {
        master: get_proxy_bidirectional_channel().clone_master(),
        slave: get_proxy_bidirectional_channel().clone_slave(),
    }
}

pub fn get_manage_pac_channel() -> wrap_proxy::PacChannel {
    wrap_proxy::PacChannel {
        master: get_pac_bidirectional_channel().clone_master(),
        slave: get_pac_bidirectional_channel().clone_slave(),
    }
}

pub fn get_manage_proxy_log_channel() -> wrap_proxy::ProxyLogChannel {
    wrap_proxy::ProxyLogChannel {
        master: get_proxy_log_bidirectional_channel().clone_master(),
        slave: get_proxy_log_bidirectional_channel().clone_slave(),
    }
}

pub fn get_manage_response_parse_channel() -> wrap_proxy::ResponseParseChannel {
    wrap_proxy::ResponseParseChannel {
        slave: get_response_parse_bidirectional_channel().clone_slave(),
    }
}

#[cfg(feature = "auth-local-server")]
pub fn get_manage_auth_channel() -> auth_server::AuthChannel {
    auth_server::AuthChannel {
        // master: auth_bidirectional_channel_master.clone(),
        slave: auth_bidirectional_channel_slave.clone(),
    }
}
