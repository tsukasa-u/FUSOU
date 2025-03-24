function FindProxyForURL(url, host) {
    // World_*
    if (shExpMatch(host, "w16s.kancolle-server.com")) { // [REPLACE HOST]

        return "PROXY 127.0.0.1:33007"; // [REPLACE ADDR]
    }

    return "DIRECT";
}

// https://developer.mozilla.org/ja/docs/Web/HTTP/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file