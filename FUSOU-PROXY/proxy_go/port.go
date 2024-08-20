package main

import (
	"encoding/json"
	"fmt"
	"net"
)

func CheckPortUsed(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

func GetFreePort() (port int, err error) {
	var a *net.TCPAddr
	if a, err = net.ResolveTCPAddr("tcp", "localhost:0"); err == nil {
		var l *net.TCPListener
		if l, err = net.ListenTCP("tcp", a); err == nil {
			defer l.Close()
			return l.Addr().(*net.TCPAddr).Port, nil
		}
	}
	return 0, err
}

type ProxyPacPortAddr struct {
	ProxyPort int    `json:"proxy_port"`
	PacPort   int    `json:"pac_port"`
	TargetURL string `json:"target_url"`
}

func (p *ProxyPacPortAddr) GetTargetURL() string {
	return p.TargetURL
}

func (p *ProxyPacPortAddr) GetProxyPort() int {
	port := p.ProxyPort
	if port != 0 {
		return port
	} else {
		free_port, err := GetFreePort()
		if err != nil {
			fmt.Println(err)
			return free_port
		}
		return 3128
	}
}

func (p *ProxyPacPortAddr) GetPacPort() int {
	port := p.PacPort
	if port != 0 {
		return port
	} else {
		free_port, err := GetFreePort()
		if err != nil {
			fmt.Println(err)
			return free_port
		}
		return 8000
	}
}

func (p *ProxyPacPortAddr) decode(jsonString string) {
	if err := json.Unmarshal([]byte(jsonString), p); err != nil {
		fmt.Println(err)
		return
	}
}

func (p *ProxyPacPortAddr) check_proxy_port() bool {
	if p.ProxyPort == p.PacPort {
		return false
	}
	if p.ProxyPort <= 3000 {
		return false
	}
	if CheckPortUsed(p.ProxyPort) {
		return false
	}
	return true
}

func (p *ProxyPacPortAddr) check_pac_port() bool {
	if p.ProxyPort == p.PacPort {
		return false
	}
	if p.PacPort <= 3000 {
		return false
	}
	if CheckPortUsed(p.PacPort) {
		return false
	}
	return true
}

func (p *ProxyPacPortAddr) checkAddr() bool {
	for _, value := range target_tul_map {
		if p.TargetURL == value {
			return true
		}
	}
	return false
}

var target_tul_map map[string]string = map[string]string{
	"横須賀鎮守府":    "203.104.209.71",
	"新呉鎮守府":     "203.104.209.87",
	"佐世保鎮守府":    "125.6.184.215",
	"舞鶴鎮守府":     "203.104.209.183",
	"大湊警備府":     "203.104.209.150",
	"トラック泊地":    "203.104.209.134",
	"リンガ泊地":     "203.104.209.167",
	"ラバウル基地":    "203.104.209.199",
	"ショートランド泊地": "125.6.189.7",
	"ブイン基地":     "125.6.189.39",
	"タウイタウイ泊地":  "125.6.189.71",
	"パラオ泊地":     "125.6.189.103",
	"ブルネイ泊地":    "125.6.189.135",
	"単冠湾泊地":     "125.6.189.167",
	"宿毛湾泊地":     "125.6.189.247",
	"幌筵泊地":      "125.6.189.215",
	"鹿屋基地":      "203.104.209.23",
	"岩川基地":      "203.104.209.39",
	"佐伯湾泊地":     "203.104.209.55",
	"柱島泊地":      "203.104.209.102",
}
