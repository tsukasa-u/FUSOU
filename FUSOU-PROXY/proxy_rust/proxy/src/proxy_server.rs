use tokio::sync::mpsc;
use warp::filters::path::FullPath;
use warp::{hyper::Body, Filter, Rejection, http::Response};
use warp_reverse_proxy::reverse_proxy_filter;
use std::io::Read;
use std::net::SocketAddr;

use warp::hyper::body::HttpBody;

use regex;

use crate::bidirectional_channel;

fn decode_content_encoding(buffer_list: Vec<Vec<u8>>, content_encoding: String) -> Vec<Vec<u8>> {
    let mut ret_buffer_list: Vec<Vec<u8>> = Vec::new();
    for buffer in buffer_list {
        let mut tmp_buffer: Vec<u8> = Vec::new();
        match content_encoding.as_str() {
            "gzip" => {
                let mut gz = flate2::read::GzDecoder::new(&buffer[..]);
                if let Ok(_) = gz.read_to_end(&mut tmp_buffer) {
                    ret_buffer_list.push(tmp_buffer.clone());
                }
            },
            "compress" => {
                todo!("compress");
            },
            "deflate" => {
                todo!("deflate");
            },
            "br" => {
                todo!("br");
            },
            _ => {}
        }
    }

    return ret_buffer_list;
}

fn decode_transfer_encoding(buffer_list: Vec<Vec<u8>>, transfer_encoding: String) -> Vec<Vec<u8>> {
    let mut ret_buffer_list: Vec<Vec<u8>> = Vec::new();
    for buffer in buffer_list {
        match transfer_encoding.as_str() {
            "chunked" => {
                let mut i = 0;
                let mut chunk_size :i64 = 0;
                let mut chunk_size_string  = "".to_string();
                let mut count: i64 = 0;
                let mut is_getting_chunk_size: bool = true;

                let mut j = 0;
                while j < buffer.len() {
                    if is_getting_chunk_size {
                        if buffer[j] == '\r' as u8 {
                            if buffer[j+1] == '\n' as u8 {
                                if chunk_size_string == "0" {
                                    break;
                                }
                                is_getting_chunk_size = false;
                                count = 0;
                                j += 1;
                                ret_buffer_list.push(Vec::new());

                                chunk_size = i64::from_str_radix(&chunk_size_string, 16).expect("Atoi");
                                continue;
                            }
                        }
                        let tmp_str = buffer[j].clone().to_string();
                        chunk_size_string.push_str(&tmp_str);
                    } else {
                        ret_buffer_list[i].push(buffer[j]);
                        count += 1;
                        if chunk_size == count {
                            is_getting_chunk_size = true;
                            i += 1;
                            chunk_size = 0;
                            chunk_size_string = "".to_string();
                            j += 2;
                        }
                    }
                }
            },
            "compress" => {
                todo!("compress");
            },
            "deflate" => {
                todo!("deflate");
            },
            "gzip" => {
                todo!("gzip");
            },
            "identity" => {
                todo!("identity");
            },
            _ => {}
        }
    }

    return ret_buffer_list;
}

async fn decode_response(response_body: Vec<u8>, content_length: i64, mut content_encoding: Vec<String>, mut transfer_encoding: Vec<String>) -> Vec<Vec<u8>> {
    // let mut buffer: Vec<u8> = Vec::<u8>::with_capacity(2<<20);
    let mut ret_buffer_list: Vec<Vec<u8>> = Vec::new();
    ret_buffer_list.push(response_body);

    if content_length < 0 {

        transfer_encoding.reverse();
        for transfer_encoding_element in transfer_encoding {
            ret_buffer_list = decode_transfer_encoding(ret_buffer_list, transfer_encoding_element);
        }

        content_encoding.reverse();
        for content_encoding_element in content_encoding {
            ret_buffer_list = decode_content_encoding(ret_buffer_list, content_encoding_element);
        }
        
    }

    return ret_buffer_list;
}

async fn log_response(mut response: Response<Body>, path: FullPath, tx_proxy_log:bidirectional_channel::Master<bidirectional_channel::StatusInfo>) -> Result<Response<Body>, Rejection> {

    let mut res = Response::builder()
        .status(response.status());

    let re_content_type = regex::Regex::new(r"(?i)Content-Type").unwrap();
    let mut content_type : String = String::new();
    let re_content_length = regex::Regex::new(r"(?i)Content-Length").unwrap();
    let mut content_length : i64 = -1;
    let re_content_encoding = regex::Regex::new(r"(?i)Content-Encoding").unwrap();
    let mut content_encoding : Vec<String> = Vec::new();
    let re_transfer_encoding = regex::Regex::new(r"(?i)Transfer-Encoding").unwrap();
    let mut transfer_encoding: Vec<String> = Vec::new();
        
    {
        let headers = res.headers_mut().unwrap();
        for (key, value) in response.headers() {
            headers.insert(key.clone(), value.clone());

            let key_string = key.clone().to_string();
            if re_content_type.is_match(&key_string) {
                content_type = value.to_str().unwrap().to_string();
            }
            if re_content_length.is_match(&key_string) {
                content_length = value.to_str().unwrap().parse().unwrap();
            }
            if re_content_encoding.is_match(&key_string) {
                let value_string = value.to_str().unwrap().to_string().trim().to_string();
                value_string.split(",")
                    // .map(|x| x.trim())
                    .for_each(|x| content_encoding.push(x.to_string()));
            }
            if re_transfer_encoding.is_match(&key_string) {
                let value_string = value.to_str().unwrap().to_string().trim().to_string();
                value_string.split(",")
                    // .map(|x| x.trim())
                    .for_each(|x| transfer_encoding.push(x.to_string()));
            }
        }
    }

    let pass: bool = match content_type.as_str() {
        "text/plain" => false,
        "application/json" => true,
        "image/png" => true,
        "video/mp4" => true,
        "audio/mpeg" => true,
        "text/html" => true,
        "text/css" => true,
        "text/javascript" => true,
        _ => true
    };
    
    println!("status: {:?}, path:{:?}, content-type:{:?}", response.status(), path, content_type);
    
    if !pass {
        let mut body = Vec::new();

        while let Some(buffer) = response.body_mut().data().await {
            body.extend_from_slice(&buffer.unwrap());
        }
        // if let Some(chunk) = response.body_mut().data().await {
        //     body.extend_from_slice(&chunk.unwrap());
        // }

        let body_cloned = body.clone();
        tokio::spawn(async move {
            let buffer_list  = decode_response(body_cloned, content_length, content_encoding, transfer_encoding).await;
            for buffer in buffer_list {
                if let Ok(buffer_string) = String::from_utf8(buffer) {
                    let mes = bidirectional_channel::StatusInfo::CONTENT {
                        status: "PROXY RUNNING".to_string(), 
                        name: "text/plain".to_string(), 
                        message: buffer_string,
                    };
                    let _ = tx_proxy_log.send(mes).await;
                } else {
                    println!("Failed to convert buffer to string");
                }
                // println!("buffer: {: <10}", String::from_utf8(buffer).unwrap()[0..10].to_string());
            }
        });

        return Ok(res.body(body.into()).unwrap());
    } else {
        return Ok(response);
    }
}

// async fn request_filter() -> Result<Request<Body>, Rejection> {
// }

// https://github.com/danielSanchezQ/warp-reverse-proxy
pub fn serve_proxy(proxy_address: String, port: u16, mut slave: bidirectional_channel::Slave<bidirectional_channel::StatusInfo>, tx_proxy_log: bidirectional_channel::Master<bidirectional_channel::StatusInfo>) -> Result<SocketAddr, Box<dyn std::error::Error>> {
    // let pac_file = include_str!("../proxy.pac");

    let routes = warp::any()
    .and(
        reverse_proxy_filter("".to_string(), proxy_address)
    )
    .and(warp::path::full())
    .map(move |res, path| {
        return (res, path, tx_proxy_log.clone());
    })
    .and_then(move |(response, path, tx)| async {
        log_response(response, path, tx).await
        // test(response)
    });
    // spawn proxy server
    let (addr, server_proxy) = warp::serve(routes).bind_with_graceful_shutdown(([127, 0, 0, 1], port), async move {
        loop {
            tokio::select! {
                recv_msg = slave.recv() => {
                    match recv_msg {
                        None => {
                            println!("Received None message");
                        },
                        Some(bidirectional_channel::StatusInfo::SHUTDOWN { status, message }) => {
                            println!("Received shutdown message: {} {}", status, message);
                            let _ = slave.send(bidirectional_channel::StatusInfo::SHUTDOWN {
                                status: "SHUTTING DOWN".to_string(),
                                message: "Proxy server is shutting down".to_string(),
                            }).await;
                            break;
                        },
                        Some(bidirectional_channel::StatusInfo::HEALTH { status, message }) => {
                            println!("Received health message: {} {}", status, message);
                            let _ = slave.send(bidirectional_channel::StatusInfo::HEALTH {
                                status: "RUNNING".to_string(),
                                message: "Proxy server is running".to_string(),
                            }).await;
                        },
                        _ => {}
                    }
                },
                _ = tokio::signal::ctrl_c() => {
                    break;
                },
            }
        }
        println!("Shutting down Proxy server");
    });
    println!("Proxy server addr: {}", addr);

    tokio::task::spawn(server_proxy);

    Ok(addr)
}