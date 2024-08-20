//go:build linux || windows

package main

import (
	"fmt"

	"github.com/cakturk/go-netstat/netstat"
)

// it may be better to send the socket informatin to external program for user
func get_port_used(port uint16) ([]netstat.SockTabEntry, error) {

	port_list := make([]netstat.SockTabEntry, 0)

	// I have no idea should I get the udpsocks or not
	// UDP only listening sockets
	socks, err := netstat.UDPSocks(func(s *netstat.SockTabEntry) bool {
		return s.State == netstat.Listen && port == s.LocalAddr.Port
	})
	if err != nil {
		// introduce error handling with gprc in the future
		fmt.Println(err)
		return nil, err
	}

	// get only listening TCP sockets
	tabs, err := netstat.TCPSocks(func(s *netstat.SockTabEntry) bool {
		return s.State == netstat.Listen && port == s.LocalAddr.Port
	})
	if err != nil {
		// introduce error handling with gprc in the future
		fmt.Println(err)
		return nil, err
	}

	port_list = append(tabs, socks...)

	return port_list, nil
}

func check_list_port_available(port_list []netstat.SockTabEntry) bool {
	if len(port_list) == 0 {
		return true
	} else {
		return false
	}
}

func check_port_available(port uint16) bool {
	port_list, err := get_port_used(port)
	if err != nil {
		fmt.Println(err)
		// introduce error handling with gprc in the future
		return true
	}

	return check_list_port_available(port_list)
}
