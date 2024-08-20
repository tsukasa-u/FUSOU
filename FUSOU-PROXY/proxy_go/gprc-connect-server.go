package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"

	"connectrpc.com/connect"

	hellopb "GoProxyServer/protos"
	"GoProxyServer/protos/helloworldconnect"
)

type GreetServer struct{}

func (s *GreetServer) Hello(
	ctx context.Context,
	req *connect.Request[hellopb.HelloRequest],
) (*connect.Response[hellopb.HelloResponse], error) {

	switch req.Msg.Version {
	case "v1":
		log.Println("Version is v1")
	default:
		log.Println("invalid version")
		// shuld I return the message that gPRC server got the invalid request?
		return nil, errors.New("invalid version")
	}

	switch req.Msg.Cmd {
	case "hello":
		log.Println("cmd is hello")
		res := connect.NewResponse(&hellopb.HelloResponse{
			Message: "Hello",
			Uuid:    "",
		})
		return res, nil
	case "start_proxy_pac":
		log.Println("cmd is start_proxy_pac")

		port_json_data := ProxyPacPortAddr{}
		port_json_data.decode(req.Msg.Content)

		proxy_port := port_json_data.GetProxyPort()
		if !port_json_data.check_proxy_port() {
			log.Println("Port for proxy is not available")
			res := connect.NewResponse(&hellopb.HelloResponse{
				Message: "filed to start proxy server and pac server becasue of the non-available port for proxy",
				Uuid:    req.Msg.Uuid,
			})
			return res, errors.New("Port for proxy is not available")
		}

		pac_port := port_json_data.GetPacPort()
		if !port_json_data.check_pac_port() {
			log.Println("Port for PAC is not available")
			res := connect.NewResponse(&hellopb.HelloResponse{
				Message: "filed to start proxy server and pac server becasue of the non-available port for pac",
				Uuid:    req.Msg.Uuid,
			})
			return res, errors.New("Port for pac is not available")
		}

		target_url := port_json_data.GetTargetURL()
		if !port_json_data.checkAddr() {
			log.Println("invalid target url")
			res := connect.NewResponse(&hellopb.HelloResponse{
				Message: "filed to start proxy server and pac server becasue of the invalid target url",
				Uuid:    req.Msg.Uuid,
			})
			return res, errors.New("invalid target url")
		}
		start_proxy_pac("defualt", proxy_port, pac_port, target_url)

		res := connect.NewResponse(&hellopb.HelloResponse{
			Message: "start proxy server with port" + strconv.Itoa(proxy_port) + " and pac server with port" + strconv.Itoa(pac_port),
			Uuid:    req.Msg.Uuid,
		})

		return res, nil
	case "start_proxy":
		log.Println("cmd is start_proxy")
		return nil, errors.New("not implemented")
	case "start_pac":
		log.Println("cmd is start_pac")
		return nil, errors.New("not implemented")
	case "stop_proxy_pac":
		log.Println("cmd is stop_proxy_pac")
		go stop_proxy_pac("default")

		res := connect.NewResponse(&hellopb.HelloResponse{
			Message: "send signal to stop proxy and pac server",
			Uuid:    req.Msg.Uuid,
		})

		return res, nil
	case "stop_proxy":
		log.Println("cmd is stop_proxy")
		return nil, errors.New("not implemented")
	case "stop_pac":
		log.Println("cmd is stop_pac")
		return nil, errors.New("not implemented")
	case "stop_gprc_connect_server":
		log.Println("cmd is stop_gprc_connect_server")
		return nil, errors.New("not implemented")
	default:
		log.Println("invalid cmd")
		// shuld I return the message that gPRC server got the invalid request?
		return nil, errors.New("invalid cmd")
	}
}

func (s *GreetServer) DownstreamHello(
	ctx context.Context,
	req *connect.Request[hellopb.HelloRequest],
	stream *connect.ServerStream[hellopb.HelloResponse],
) error {
	sigint := make(chan os.Signal, 1)
	signal.Notify(sigint, os.Interrupt)

	if channel_manager.isEmpty("default") {
		stream.Send(&hellopb.HelloResponse{
			Message: "channel is not found",
		})
		return errors.New("channel is not found")
	}

	res_data_chan := channel_manager.GetResDataChannel("default")
	// signal_serve_gprc_connect_chan := channel_manager.GetProxyServerChannel("default")

LOOP:
	for {
		select {
		case <-sigint:
			println("Interrupted")
			break LOOP
		case res_data := <-res_data_chan:
			if res_data == "stop" {
				break LOOP
			} else {
				if err := stream.Send(&hellopb.HelloResponse{
					Message: res_data,
				}); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func start_gprc_connect_server(signal_serve_gprc_connect_chan chan string, port int) {

	idleConnsClosed := make(chan struct{})

	greeter := &GreetServer{}
	mux := http.NewServeMux()
	path, handler := helloworldconnect.NewGreetingServiceHandler(greeter)
	mux.Handle(path, handler)
	srv := &http.Server{
		Addr:    ":" + strconv.Itoa(port),
		Handler: mux,
	}

	wg.Add(1)
	go func() {
		sigint := make(chan os.Signal, 1)
		signal.Notify(sigint, os.Interrupt)

	LOOP:
		for {
			select {
			case <-sigint:
				println("Interrupted")
				break LOOP
			case <-signal_serve_gprc_connect_chan:
				println("Signal received from main.go to stop serving gprc connect server.")
				// Is needed? be careful for panic
				// close(signal_serve_gprc_connect_chan)
				break LOOP
			}
		}

		// We received an interrupt signal, shut down.
		if err := srv.Shutdown(context.Background()); err != nil {
			// Error from closing listeners, or context timeout:
			log.Printf("gPRC server Shutdown: %v", err)
		}
		close(idleConnsClosed)
		defer wg.Done()
		println("gRPC server go routine is stopped.")
	}()

	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("failed to serve: %v", err)
	}

	<-idleConnsClosed

	defer wg.Done()

	// srv.ListenAndServeTLS(cert, key)

	// http.ListenAndServe(
	// 	":"+strconv.Itoa(port),
	// 	// Use h2c so we can serve HTTP/2 without TLS.
	// 	h2c.NewHandler(mux, &http2.Server{}),
	// )
	println("gRPC server is stopped.")
}
