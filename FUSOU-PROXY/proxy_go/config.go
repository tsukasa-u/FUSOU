package main

import (
	"fmt"
	"os"
)

func initParam() {

}

func getConfig() {

}

func setConfig() {

}

func readJson() {

	jsonFile, err := os.Open("test.json")
	if err != nil {
		// introduce error handling with gprc in the future
		fmt.Println(err)
		return
	}
	defer jsonFile.Close()

	// jsonData, err := ioutil.ReadAll(jsonFile)
	// if err != nil {
	// 	// introduce error handling with gprc in the future
	// 	fmt.Println(err)
	// 	return
	// }

	// var post Post
	// json.Unmarshal(jsonData, &post)

	// fmt.Println(post)
	// fmt.Println(post.Comments)
	// fmt.Println(post.Comments[0].Content)
}

func writeJson() {

}
