function FindProxyForURL(url, host) {
    // World_*
    if (shExpMatch(host, "w01y.kancolle-server.com") ||
        shExpMatch(host, "w02k.kancolle-server.com") ||
        shExpMatch(host, "w03s.kancolle-server.com") ||
        shExpMatch(host, "w04m.kancolle-server.com") ||
        shExpMatch(host, "w05o.kancolle-server.com") ||
        shExpMatch(host, "w06k.kancolle-server.com") ||
        shExpMatch(host, "w07l.kancolle-server.com") ||
        shExpMatch(host, "w08r.kancolle-server.com") ||
        shExpMatch(host, "w09s.kancolle-server.com") ||
        shExpMatch(host, "w10b.kancolle-server.com") ||
        shExpMatch(host, "w11t.kancolle-server.com") ||
        shExpMatch(host, "w12p.kancolle-server.com") ||
        shExpMatch(host, "w13b.kancolle-server.com") ||
        shExpMatch(host, "w14h.kancolle-server.com") ||
        shExpMatch(host, "w15p.kancolle-server.com") ||
        shExpMatch(host, "w16s.kancolle-server.com") ||
        shExpMatch(host, "w17k.kancolle-server.com") ||
        shExpMatch(host, "w18i.kancolle-server.com") ||
        shExpMatch(host, "w19s.kancolle-server.com") ||
        shExpMatch(host, "w20h.kancolle-server.com")) {
    // if (isInNet(host, "203.104.209.71" , "255.255.255.255") ||
    //     isInNet(host, "203.104.209.87" , "255.255.255.255") ||
    //     isInNet(host, "125.6.184.215"  , "255.255.255.255") ||
    //     isInNet(host, "203.104.209.183", "255.255.255.255") ||
    //     isInNet(host, "203.104.209.150", "255.255.255.255") ||
    //     isInNet(host, "203.104.209.134", "255.255.255.255") ||
    //     isInNet(host, "203.104.209.167", "255.255.255.255") ||
    //     isInNet(host, "203.104.209.199", "255.255.255.255") ||
    //     isInNet(host, "125.6.189.7"    , "255.255.255.255") ||
    //     isInNet(host, "125.6.189.39"   , "255.255.255.255") ||
    //     isInNet(host, "125.6.189.71"   , "255.255.255.255") ||
    //     isInNet(host, "125.6.189.103"  , "255.255.255.255") ||
    //     isInNet(host, "125.6.189.135"  , "255.255.255.255") ||
    //     isInNet(host, "125.6.189.167"  , "255.255.255.255") ||
    //     isInNet(host, "125.6.189.247"  , "255.255.255.255") ||
    //     isInNet(host, "125.6.189.215"  , "255.255.255.255") ||
    //     isInNet(host, "203.104.209.23" , "255.255.255.255") ||
    //     isInNet(host, "203.104.209.39" , "255.255.255.255") ||
    //     isInNet(host, "203.104.209.55" , "255.255.255.255") ||
    //     isInNet(host, "203.104.209.102", "255.255.255.255")) {
                
        ip_addr = myIpAddress();

        // priivate IP adress (RFC 1918)
        // Class A
        // Class B
        // Class C
        // localhost
        if (isInNet(ip_addr, "10.0.0.0"   , "255.0.0.0"      ) ||
            isInNet(ip_addr, "172.16.0.0" , "255.240.0.0"    ) ||
            isInNet(ip_addr, "192.168.0.0", "255.255.0.0"    ) ||
            isInNet(ip_addr, "127.0.0.1"  , "255.255.255.255")) {

            // 80
            if (shExpMatch(url, "http:*")) {
                return "PROXY 127.0.0.1:8000"; // [REPLACE ADDR WORLD:80]
            }

            // 443
            // if (shExpMatch(url, "https:*")) {
            //     return "PROXY 127.0.0.1:3129"
            // }
        }
    }
    // Gadget
    // else if (isInNet(host, "203.104.209.7"  , "255.255.255.255")) {
        
    //     // 80
    //     if (shExpMatch(url, "http:*")) {
    //         return "PROXY 127.0.0.1:3130";
    //     }

    //     // 443
    //     if (shExpMatch(url, "https:*")) {
    //         return "PROXY 127.0.0.1:3131"
    //     }
    // }

    return "DIRECT";
}

// https://developer.mozilla.org/ja/docs/Web/HTTP/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file