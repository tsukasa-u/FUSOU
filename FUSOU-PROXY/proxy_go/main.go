package main

import (
	"log"
	"sync"
	"time"

	errors "errors"
)

var channel_manager *ChannelManager = NewChannelManager()
var wg sync.WaitGroup

func start_proxy_pac(key string, proxy_port int, pac_port int, target_url string) {

	channel_buffer := 32

	var error_signal_chan chan string = make(chan string)
	var res_data_chan chan string = make(chan string, channel_buffer)
	var signal_serve_pac_chan chan string = make(chan string)
	var signal_serve_proxy_chan chan string = make(chan string)

	channel_manager.AddChannelInfo(key, signal_serve_pac_chan, signal_serve_proxy_chan, res_data_chan, error_signal_chan)

	if err := start_serve_pac(pac_port); err != nil {
		log.Fatal(err)
	}

	if err := start_proxy(proxy_port, target_url); err != nil {
		log.Fatal(err)
	}
}

func stop_proxy_pac(key string) (error, error, error) {

	defer wg.Done()
	var channel_info, ok = channel_manager.GetChannelInfo(key)
	if ok {
		var err_proxy error = nil
		var err_pac error = nil
		var err_res_data error = nil
		select {
		case channel_info.resDataChannelManager.ResDataChannel <- "stop":
		case <-time.After(5 * time.Second):
			{
				// regard as the proxy server is shut downed
				err_res_data = errors.New("gprc server is not responed in 5 sec.")
			}
		}
		select {
		case channel_info.ProxyServerChannel <- "stop":
		case <-time.After(5 * time.Second):
			{
				// regard as the proxy server is shut downed
				err_proxy = errors.New("roxy server is not responed in 5 sec.")
			}
		}
		select {
		case channel_info.PacServerChannel <- "stop":
		case <-time.After(5 * time.Second):
			{
				// regard as the PAC server is shut downed
				err_pac = errors.New("PAC server is not responed in 5 sec.")
			}
		}
		channel_manager.DeleteChannelInfo(key)
		return err_res_data, err_proxy, err_pac
	}

	not_fond_error := errors.New("The key is not found in the channel manager.")
	return not_fond_error, not_fond_error, not_fond_error
}

func main() {

	var signal_serve_gprc_connect_chan chan string = make(chan string)
	wg.Add(1)
	go start_gprc_connect_server(signal_serve_gprc_connect_chan, 8080)

	target_url := "125.6.189.247"
	start_proxy_pac("default", 3128, 8000, target_url)

	wg.Wait()
	println("All servers are stopped.")
}

// https://zenn.dev/okkn/articles/20221217-01_tech_gocm-api
// https://mixi-developers.mixi.co.jp/go-tips-when-building-web-server-384c8242f5ff
