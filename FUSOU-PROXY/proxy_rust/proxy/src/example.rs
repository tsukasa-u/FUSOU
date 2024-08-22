use warp::{hyper::Body, Filter, Rejection, Reply, http::Response};
use warp_reverse_proxy::reverse_proxy_filter;

// use warp::Filter;
use futures_util::future::TryFutureExt;
use tokio::sync::oneshot;

async fn log_response(response: Response<Body>) -> Result<impl Reply, Rejection> {
    
    println!("{:?}", response);
    Ok(response)
}

#[tokio::main]
async fn main() {
    let route = warp::any().map(|| "hello world");
    // // spawn base server
    tokio::spawn(warp::serve(route).run(([0, 0, 0, 0], 9080)));
        
    let (tx, rx) = oneshot::channel::<bool>();

    // Forward request to localhost in other port
    let app = warp::any().and(
        reverse_proxy_filter("".to_string(), "http://127.0.0.1:9080/".to_string())
            .and_then(log_response),
    );
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