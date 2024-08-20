function FindProxyForURL(url, host) {

    if (isInNet(host, "203.104.209.71" , "255.255.255.255") ||
        isInNet(host, "203.104.209.87" , "255.255.255.255") ||
        isInNet(host, "125.6.184.215"  , "255.255.255.255") ||
        isInNet(host, "203.104.209.183", "255.255.255.255") ||
        isInNet(host, "203.104.209.150", "255.255.255.255") ||
        isInNet(host, "203.104.209.134", "255.255.255.255") ||
        isInNet(host, "203.104.209.167", "255.255.255.255") ||
        isInNet(host, "203.104.209.199", "255.255.255.255") ||
        isInNet(host, "125.6.189.7"    , "255.255.255.255") ||
        isInNet(host, "125.6.189.39"   , "255.255.255.255") ||
        isInNet(host, "125.6.189.71"   , "255.255.255.255") ||
        isInNet(host, "125.6.189.103"  , "255.255.255.255") ||
        isInNet(host, "125.6.189.135"  , "255.255.255.255") ||
        isInNet(host, "125.6.189.167"  , "255.255.255.255") ||
        isInNet(host, "125.6.189.247"  , "255.255.255.255") ||
        isInNet(host, "125.6.189.215"  , "255.255.255.255") ||
        isInNet(host, "203.104.209.23" , "255.255.255.255") ||
        isInNet(host, "203.104.209.39" , "255.255.255.255") ||
        isInNet(host, "203.104.209.55" , "255.255.255.255") ||
        isInNet(host, "203.104.209.102", "255.255.255.255")) {
                
        ip_addr = myIpAddress();

        // priivate IP adress (RFC 1918)
        // Class A
        // Class B
        // Class C
        // localhost
        if (isInNet(ip_addr, "10.0.0.0"   , "255.0.0.0"      ) ||
            isInNet(ip_addr, "172.16.0.0" , "255.240.0.0"    ) ||
            isInNet(ip_addr, "192.168.0.0", "255.255.0.0"    ) ||
            isInNet(ip_addr, "127.0.1.1"  , "255.255.255.255")) {

            // 80
            if (shExpMatch(url, "http:*")) {
                return "PROXY 127.0.0.1:3128";
            }

            // 443
            if (shExpMatch(url, "https:*")) {
                return "PROXY 127.0.0.1:3129"
            }
        }
    }
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

// https://docs.google.com/spreadsheets/d/19HRVqo5tT2SilLAKNIihwQtzT6cLjB81lcrzXhkzwcM/edit#gid=0
// 横須賀鎮守府	203.104.209.71
// 新呉鎮守府	203.104.209.87
// 佐世保鎮守府	125.6.184.215
// 舞鶴鎮守府	203.104.209.183
// 大湊警備府	203.104.209.150
// トラック泊地	203.104.209.134
// リンガ泊地	203.104.209.167
// ラバウル基地	203.104.209.199
// ショートランド泊地	125.6.189.7
// ブイン基地	125.6.189.39
// タウイタウイ泊地	125.6.189.71
// パラオ泊地	125.6.189.103
// ブルネイ泊地	125.6.189.135
// 単冠湾泊地	125.6.189.167
// 宿毛湾泊地	125.6.189.247
// 幌筵泊地	125.6.189.215
// 鹿屋基地	203.104.209.23
// 岩川基地	203.104.209.39
// 佐伯湾泊地	203.104.209.55
// 柱島泊地	203.104.209.102

// ConstServerInfo.Gadget           = "http://203.104.209.7/";
// ConstServerInfo.World_1          = "http://203.104.209.71/";
// ConstServerInfo.World_2          = "http://203.104.209.87/";
// ConstServerInfo.World_3          = "http://125.6.184.215/";
// ConstServerInfo.World_4          = "http://203.104.209.183/";
// ConstServerInfo.World_5          = "http://203.104.209.150/";
// ConstServerInfo.World_6          = "http://203.104.209.134/";
// ConstServerInfo.World_7          = "http://203.104.209.167/";
// ConstServerInfo.World_8          = "http://203.104.209.199/";
// ConstServerInfo.World_9          = "http://125.6.189.7/";
// ConstServerInfo.World_10         = "http://125.6.189.39/";
// ConstServerInfo.World_11         = "http://125.6.189.71/";
// ConstServerInfo.World_12         = "http://125.6.189.103/";
// ConstServerInfo.World_13         = "http://125.6.189.135/";
// ConstServerInfo.World_14         = "http://125.6.189.167/";
// ConstServerInfo.World_15         = "http://125.6.189.215/";
// ConstServerInfo.World_16         = "http://125.6.189.247/";
// ConstServerInfo.World_17         = "http://203.104.209.23/";
// ConstServerInfo.World_18         = "http://203.104.209.39/";
// ConstServerInfo.World_19         = "http://203.104.209.55/";
// ConstServerInfo.World_20         = "http://203.104.209.102/";
// ConstServerInfo.OSAPI            = "osapi.dmm.com";
// ConstServerInfo.NETGAME          = "http://www.dmm.com";