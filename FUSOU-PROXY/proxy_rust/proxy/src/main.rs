use std::io::Read;

use warp::{hyper::Body, Filter, Rejection, http::Response};
use warp_reverse_proxy::reverse_proxy_filter;
use warp::hyper::body::HttpBody;

use tokio::sync::oneshot;

use regex;

async fn decode_response(response_body: Vec<u8>) {

}

async fn log_response(mut response: Response<Body>) -> Result<Response<Body>, Rejection> {

    // println!("Response: {:?}", response);

    let mut res = Response::builder()
        .status(response.status());

    let re_content_type = regex::Regex::new(r"(?i)Content-Type").unwrap();
    let mut content_type : String = String::new();
    let re_content_length = regex::Regex::new(r"(?i)Content-Length").unwrap();
    let mut content_length : usize = 0;
    let re_content_encoding = regex::Regex::new(r"(?i)Content-Encoding").unwrap();
    let mut content_encoding : Vec<String> = Vec::new();
        
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
                let mut value_string = value.to_str().unwrap().to_string().trim().to_string();
                value_string.split(",")
                    // .map(|x| x.trim())
                    .for_each(|x| content_encoding.push(x.to_string()));
                // content_encoding.reverse();
            }
            // println!("{:?}", headers);
        }
    }

    let pass: bool = match content_type.as_str() {
        "application/json" => false,
        "text/plain" => false,
        "image/png" => false,
        "video/mp4" => true,
        "audio/mpeg" => true,
        "text/html" => true,
        "text/css" => true,
        "text/javascript" => true,
        _ => true
    };
    
    if !pass {
        let mut body = Vec::new();
        if let Some(chunk) = response.body_mut().data().await {
            body.extend_from_slice(&chunk.unwrap());
            // println!("{:?}", String::from_utf8(body.clone()).unwrap());
        }

        let body_cloned = body.clone();
        tokio::spawn(async move {
            decode_response(body_cloned).await;
        });

        return Ok(res.body(body.into()).unwrap());
    } else {
        return Ok(response);
    }
}

#[tokio::main]
async fn main() {
    let route = warp::any().map(|| "hello world");
    // // spawn base server
    tokio::spawn(warp::serve(route).run(([0, 0, 0, 0], 9080)));
        
    let (tx, rx) = oneshot::channel::<bool>();

    // Forward request to localhost in other port
    let app = warp::any()
    .and(
        reverse_proxy_filter("".to_string(), "http://127.0.0.1:9080/".to_string())
            
    ).and_then(log_response);
    // spawn proxy server
    let (addr, server) = warp::serve(app).bind_with_graceful_shutdown(([127, 0, 0, 1], 3030), async move {
        tokio::select! {
            _ = rx => {},
            _ = tokio::signal::ctrl_c() => {},
        }
        println!("Shutting down");
        println!("input 'exit' to exit");
    });

    tokio::task::spawn(server);

    loop {
        let mut input = String::new();
        std::io::stdin().read_line(&mut input).unwrap();
        if input.trim() == "exit" {
            break;
        }
    }
}
