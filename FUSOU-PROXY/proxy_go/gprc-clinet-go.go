package main

import (
	"bufio"
	"fmt"
	"log"
	"os"

	hellopb "GoProxyServer/protos"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	scanner *bufio.Scanner
	client  hellopb.GreetingServiceClient
)

func gprc_server() {
	fmt.Println("start gRPC Client.")

	// 1. 標準入力から文字列を受け取るスキャナを用意
	scanner = bufio.NewScanner(os.Stdin)

	// creds, err := credentials.NewClientTLSFromFile("server.crt", "")

	// 2. gRPCサーバーとのコネクションを確立
	address := "localhost:50051"
	conn, err := grpc.NewClient(
		address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		// grpc.WithTransportCredentials(creds),
	)
	if err != nil {
		log.Fatal("Connection failed.")
		return
	}
	defer conn.Close()

	// 3. gRPCクライアントを生成
	client = hellopb.NewGreetingServiceClient(conn)

	for {
		fmt.Println("1: send Request")
		fmt.Println("2: exit")
		fmt.Print("please enter >")

		scanner.Scan()
		in := scanner.Text()

		switch in {
		case "1":
			Hello()

		case "2":
			fmt.Println("bye.")
			goto M
		}
	}
M:
}

func Hello() {
	// fmt.Println("Please enter your name.")
	// scanner.Scan()
	// name := scanner.Text()

	// req := &hellopb.HelloRequest{
	// 	Name: name,
	// }
	// res, err := client.Hello(context.Background(), req)
	// if err != nil {
	// 	fmt.Println(err)
	// } else {
	// 	fmt.Println(res.GetMessage())
	// }
}

// https://note.com/leslesnoa/n/n183c741a2ab2
