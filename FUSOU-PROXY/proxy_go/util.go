package main

import "bytes"

func deep_copy_byte_buffer(src *bytes.Buffer) *bytes.Buffer {
	dst := new(bytes.Buffer)
	dst.Write(src.Bytes())
	return dst
}
