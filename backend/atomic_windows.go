package main

import "syscall"

func replaceFile(from, to string) error {
	a, e := syscall.UTF16PtrFromString(from)
	if e != nil {
		return e
	}
	b, e := syscall.UTF16PtrFromString(to)
	if e != nil {
		return e
	}
	proc := syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW")
	ok, _, err := proc.Call(uintptrPointer(a), uintptrPointer(b), 0x1|0x8)
	if ok == 0 {
		return err
	}
	return nil
}
