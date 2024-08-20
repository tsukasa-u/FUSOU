package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
)

func start_serve_pac(port int) error {

	var error_signal_chan chan string
	var signal_serve_pac_chan chan string
	if channel_manager != nil {
		if !channel_manager.isEmpty("default") {
			signal_serve_pac_chan = channel_manager.GetPacServerChannel("default")
			error_signal_chan = channel_manager.GetErrorSignalChannel("default")
			if signal_serve_pac_chan == nil || error_signal_chan == nil {
				return errors.New("channel is not found")
			}
		} else {
			return errors.New("channel is not found")
		}
	}

	wg.Add(1)
	go func() {
		defer wg.Done()

		idleConnsClosed := make(chan struct{})

		frontendProxy := http.Server{
			Addr:    ":" + strconv.Itoa(port),
			Handler: http.FileServer(http.Dir("proxy_settings")),
		}

		wg.Add(1)
		go func() {
			defer wg.Done()

			sigint := make(chan os.Signal, 1)
			signal.Notify(sigint, os.Interrupt)
		LOOP:
			for {
				select {
				case <-sigint:
					println("Interrupted")
					break LOOP
				case <-signal_serve_pac_chan:
					println("Signal received from main.go to stop serving PAC file.")
					break LOOP
				}
			}

			// We received an interrupt signal, shut down.
			if err := frontendProxy.Shutdown(context.Background()); err != nil {
				// Error from closing listeners, or context timeout:
				log.Printf("HTTP server Shutdown: %v", err)
			}
			close(idleConnsClosed)

			println("PAC server go routine is stopped.")
		}()

		if err := frontendProxy.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			// Error starting or closing listener:
			log.Fatalf("HTTP server ListenAndServe: %v", err)
		}
		<-idleConnsClosed

		println("PAC server is stopped.")
	}()
	return nil
}
