package main

// https://automationlabo.com/wat/?p=12339
// https://motemen.hatenablog.com/entry/2014/12/02/go-loghttp
// https://mattn.kaoriya.net/software/lang/go/20141202173521.htm

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

func get_content_encoding(dump string) []string {
	content_encoding := regexp.MustCompile(`Content-Encoding: [a-z,\s]*\r\n`).FindString(dump)
	if content_encoding == "" {
		return make([]string, 0)
	}
	content_encoding_no_srn := strings.ReplaceAll(strings.TrimSpace(content_encoding), " ", "")
	content_encoding_map_string := strings.Split(content_encoding_no_srn, ":")
	content_encoding_map := strings.Split(content_encoding_map_string[1], ",")
	return content_encoding_map
}

func decode_content_encoding(dump_body []byte, content_length int, content_encoding_map []string, transfer_encoding []string) ([]*bytes.Buffer, error) {

	wb_list := make([]*bytes.Buffer, 0)
	if content_length >= 0 {
		wb := new(bytes.Buffer)
		wb_list := append(wb_list, wb)
		_, err := wb_list[0].Write(dump_body)
		if err != nil {
			return wb_list, err
		}
	} else {
		wb := new(bytes.Buffer)
		wb.Write(dump_body)
		wb_list = append(wb_list, wb)
		slices.Reverse(transfer_encoding)
		for _, encoding := range transfer_encoding {
			_wb_list := make([]*bytes.Buffer, 0)
			for _, wb := range wb_list {
				switch encoding {
				case "chunked":
					// println("chunked")
					_dump_body := wb.Bytes()
					i := 0
					var chunk_size int64 = 0
					var chunk_size_string string = ""
					var count int64 = 0
					var is_getting_chunk_size bool = true
					for j := 0; j < len(_dump_body); j++ {
						if is_getting_chunk_size {
							if _dump_body[j] == '\r' {
								if _dump_body[j+1] == '\n' {
									// println("chunk_size_string", chunk_size_string)
									if chunk_size_string == "0" {
										// println("reach the end of chunked encoding")
										break
									}
									is_getting_chunk_size = false
									count = 0
									j++
									_wb_list = append(_wb_list, new(bytes.Buffer))

									var err error
									chunk_size, err = strconv.ParseInt(chunk_size_string, 16, 64)
									if err != nil {
										println("Atoi", err.Error())
										return wb_list, err
									}
									continue
								}
							}
							chunk_size_string = chunk_size_string + string(_dump_body[j])
							// chunk_size = chunk_size<<8 | uint(_dump_body[j])
						} else {
							_wb_list[i].WriteByte(_dump_body[j])
							count++
							if chunk_size == count {
								is_getting_chunk_size = true
								i++
								chunk_size = 0
								chunk_size_string = ""
								j += 2
							}
						}
					}
				case "compress":
					// println("compress")
				case "deflate":
					// println("deflate")
				case "gzip":
					// println("gzip")
				case "identity":
					// println("identity")
				}
			}
			wb_list = _wb_list
			// how to free memory of array?
		}

		// io.Copy is a bad method for coping the buffer of resonponse body ?
		slices.Reverse(content_encoding_map)
		_wb_list := make([]*bytes.Buffer, 0)
		for _, wb := range wb_list {
			_wb := new(bytes.Buffer)
			for _, encoding := range content_encoding_map {
				switch encoding {
				case "gzip":
					// println("gzip")
					reader, err := gzip.NewReader(wb)
					defer reader.Close()
					if err != nil {
						println("newReader", err.Error())
						return wb_list, err
					}

					_, err = io.Copy(_wb, reader)
					if err != nil {
						println("Copy", err.Error())
						return wb_list, err
					}
				case "compress":
					// println("compress")
					// reader := lzw.NewReader(wb, lzw.LSB, 8)
					// 		// I don't know which is correct LSB or MSB and how do I set the lit width
				case "deflate":
					// println("deflate")
					// reader := flate.NewReader(wb)
				case "br":
					// println("br")
					// reader := brotli.NewReader(wb)
				}
			}
			_wb_list = append(_wb_list, _wb)
		}
		wb_list = _wb_list
	}
	// I'm not sure that I could handle the copy of array correctly
	return wb_list, nil
}

func get_content_type(dump string) string {
	content_type := regexp.MustCompile(`Content-Type: .*\r\n`).FindString(dump)
	content_type_no_rn := strings.TrimSpace(content_type)
	content_type_map := strings.Split(content_type_no_rn, ": ")
	return content_type_map[1]
}

func start_proxy(port int, target_url string) error {

	var error_signal_chan chan string
	var signal_serve_proxy_chan chan string
	if channel_manager != nil {
		if !channel_manager.isEmpty("default") {
			signal_serve_proxy_chan = channel_manager.GetProxyServerChannel("default")
			error_signal_chan = channel_manager.GetErrorSignalChannel("default")
			if signal_serve_proxy_chan == nil || error_signal_chan == nil {
				return errors.New("channel is not found")
			}
		} else {
			return errors.New("channel is not found")
		}
	}

	rpURL, err := url.Parse(target_url)
	if err != nil {
		// introduce error handling with gprc in the future
		log.Fatal(err)
	}

	wg.Add(1)
	go func() {
		defer wg.Done()

		idleConnsClosed := make(chan struct{})

		modifyResponse := func(res *http.Response) error {
			// fmt.Println(res.Request.URL, res.Request.Host, res.Request.Method, res.Request.Proto, res.Request.ProtoMajor, res.Request.ProtoMinor, res.Request.RemoteAddr, res.Request.RequestURI, res.Request.TLS, res.Request.Trailer, res.Request.TransferEncoding)

			if res.StatusCode != http.StatusOK {
				println("return with status code", res.StatusCode)
				return nil
			}

			dump, err := httputil.DumpResponse(res, false)
			if err != nil {
				// introduce error handling with gprc in the future
				println(err)
				return err
			}
			// fmt.Printf("%q\r\n", dump)
			content_type := get_content_type(string(dump))
			dump_body, err := httputil.DumpResponse(res, true)
			if err != nil {
				println(err)
				return err
			}
			dump_body = dump_body[len(dump) : len(dump_body)-1]

			if content_type == "text/plain" {
				if defualt_channel, ok := channel_manager.GetChannelInfo("default"); ok {

					wg.Add(1)
					go func() {
						defer wg.Done()
						reserved_key := defualt_channel.resDataChannelManager.ReserveResDataChannel()

						content_encoding_map := get_content_encoding(string(dump))
						ws, err := decode_content_encoding(dump_body, int(res.ContentLength), content_encoding_map, res.TransferEncoding)
						if err != nil {
							println(err)
							return
						}

						res_data_chan := channel_manager.GetResDataChannel("default")
						if res_data_chan == nil {
							return
						}

						defualt_channel.resDataChannelManager.Lock(reserved_key)
						// fmt.Println("recievable", defualt_channel.resDataChannelManager.recievable)
						fmt.Println(res.Request.Method, res.Status, res.Request.URL, content_type, content_encoding_map, res.TransferEncoding, "recievable:", defualt_channel.resDataChannelManager.recievable)
						if defualt_channel.resDataChannelManager.recievable {
							for _, w := range ws {

								// select {
								// case res_data_chan <- "data=" + w.String():
								// case <-time.After(1 * time.Second):
								// }
								fmt.Println("data=" + w.String())
							}
						}
						defualt_channel.resDataChannelManager.UnLock(reserved_key)
					}()
				}

			}

			// I don't know the code in the next line is need or not
			// defer res.Body.Close()
			return nil
		}

		Director := func(req *http.Request) {
			// dump, err := httputil.DumpRequest(req, false)
			// fmt.Printf("%s", string(dump))
		}

		rp := httputil.NewSingleHostReverseProxy(rpURL)
		rp.ModifyResponse = modifyResponse
		rp.Director = Director
		rp.Transport = &http.Transport{
			DisableKeepAlives: true,
		}

		// https://christina04.hatenablog.com/entry/go-timeouts
		// https://blog.cloudflare.com/the-complete-guide-to-golang-net-http-timeouts/
		frontendProxy := http.Server{
			ReadTimeout:  0,
			WriteTimeout: 0,
			IdleTimeout:  0,
			Addr:         ":" + strconv.Itoa(port),
			Handler:      rp,
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
					// goto BP
				case <-signal_serve_proxy_chan:
					println("Signal received from main.go to stop serving proxy")
					break LOOP
					// goto BP
				}
			}
			// shoud I not to use goto syntax?
			// BP:

			// We received an interrupt signal, shut down.
			if err := frontendProxy.Shutdown(context.Background()); err != nil {
				// Error from closing listeners, or context timeout:
				log.Printf("HTTP server Shutdown: %v", err)
			}
			close(idleConnsClosed)
			println("Proxy server go routine is stopped.")
		}()

		// if err := frontendProxy.ListenAndServeTLS("./cert/localhost.pem", "./cert/localhost-key.pem"); !errors.Is(err, http.ErrServerClosed) {
		// 	// Error starting or closing listener:
		// 	log.Fatalf("HTTP server ListenAndServe: %v", err)
		// }
		if err := frontendProxy.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			// Error starting or closing listener:
			log.Fatalf("HTTP server ListenAndServe: %v", err)
		}
		<-idleConnsClosed

		// defer frontendProxy.Shutdown(context.Background())
		println("Proxy server is stopped.")
	}()

	return nil
}

// refrerence
// https://zenn.dev/tksx1227/articles/5ab5b3c99336c3
// https://www.fml.org/home/fukachan/ja/tech.wpad.html
// https://qiita.com/castaneai/items/7815f3563b256ae9b18d

// need to search to fix the proxy error with unexpected EOF
// https://qiita.com/tsujimitsu/items/f4fbd47118cbbd9441fc

// unkown error
// 2024/07/12 16:32:53 http: proxy error: EOF
// 2024/07/14 06:38:59 http: proxy error: dial tcp 125.6.189.247:80: connectex: A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond.
