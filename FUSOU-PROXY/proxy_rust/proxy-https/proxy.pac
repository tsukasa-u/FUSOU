function FindProxyForURL(url, host) {
    // World_*
    // Gadget
    if (shExpMatch(host, "w00g.kancolle-server.com") ||
        shExpMatch(host, "w01y.kancolle-server.com") ||
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

        return "PROXY 127.0.0.1:3000"; // [REPLACE ADDR]
    }

    return "DIRECT";
}

// https://developer.mozilla.org/ja/docs/Web/HTTP/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file