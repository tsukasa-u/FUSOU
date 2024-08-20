package main

import (
	"errors"
	"sync"
)

type ChannelManager struct {
	ChannelMap map[string]*channelInfo
}

type channelInfo struct {
	PacServerChannel      chan string
	ProxyServerChannel    chan string
	ErrorSignalChannel    chan string
	resDataChannelManager resDataChannelMutex
}

type resDataChannelMutex struct {
	mu             sync.Mutex
	ResDataChannel chan string
	ReservedCount  int
	PullCount      int
	recievable     bool
}

func (r *resDataChannelMutex) CancelReservedResDataChannel() error {
	return errors.New("not implemented")
}

func (r *resDataChannelMutex) ReserveResDataChannel() int {
	ret := r.ReservedCount
	r.ReservedCount++
	return ret
}

func (r *resDataChannelMutex) UnLock(key int) error {
	// Is it correctly working?
	// I'm not sure that the order of re-locked mutex becomes lowest.
LOOP:
	for {
		r.mu.Unlock()
		if key == r.PullCount {
			break LOOP
		} else if key < r.PullCount {
			return errors.New("key is not valid")
		}
		r.mu.Lock()
	}
	return nil
}

func (r *resDataChannelMutex) Lock(key int) error {
	r.mu.Lock()
	if key == r.PullCount {
		r.PullCount++
	} else {
		return errors.New("key is not valid")
	}
	return nil
}

func NewChannelManager() *ChannelManager {
	return &ChannelManager{
		ChannelMap: make(map[string]*channelInfo),
	}
}

func (cm *ChannelManager) AddChannelInfo(key string, pacServerChannel chan string, proxyServerChannel chan string, resDataChannel chan string, ErrorSignalChannel chan string) {
	cm.ChannelMap[key] = &channelInfo{
		PacServerChannel:   pacServerChannel,
		ProxyServerChannel: proxyServerChannel,
		ErrorSignalChannel: ErrorSignalChannel,
		resDataChannelManager: resDataChannelMutex{
			ResDataChannel: resDataChannel,
			mu:             sync.Mutex{},
			ReservedCount:  0,
			PullCount:      0,
			recievable:     false,
		},
	}
}

func (cm *ChannelManager) GetChannelInfo(key string) (*channelInfo, bool) {
	channelInfo, ok := cm.ChannelMap[key]
	return channelInfo, ok
}

func (cm *ChannelManager) DeleteChannelInfo(key string) {
	if channelInfo, ok := cm.ChannelMap[key]; ok {
		if channelInfo.PacServerChannel != nil {
			close(channelInfo.PacServerChannel)
		}
		if channelInfo.ProxyServerChannel != nil {
			close(channelInfo.ProxyServerChannel)
		}
		if channelInfo.resDataChannelManager.ResDataChannel != nil {
			close(channelInfo.resDataChannelManager.ResDataChannel)
		}
		if channelInfo.ErrorSignalChannel != nil {
			close(channelInfo.ErrorSignalChannel)
		}
	}
	delete(cm.ChannelMap, key)
}

func (cm *ChannelManager) GetErrorSignalChannel(key string) chan string {
	channelInfo, ok := cm.GetChannelInfo(key)
	if ok {
		return channelInfo.ErrorSignalChannel
	}
	return nil
}

func (cm *ChannelManager) GetPacServerChannel(key string) chan string {
	channelInfo, ok := cm.GetChannelInfo(key)
	if ok {
		return channelInfo.PacServerChannel
	}
	return nil
}

func (cm *ChannelManager) GetProxyServerChannel(key string) chan string {
	channelInfo, ok := cm.GetChannelInfo(key)
	if ok {
		return channelInfo.ProxyServerChannel
	}
	return nil
}

func (cm *ChannelManager) GetResDataChannel(key string) chan string {
	channelInfo, ok := cm.GetChannelInfo(key)
	if ok {
		return channelInfo.resDataChannelManager.ResDataChannel
	}
	return nil
}

func (cm *ChannelManager) GetdefaultChannelInfo() (*channelInfo, error) {
	if len(cm.ChannelMap) == 1 {
		return cm.ChannelMap["default"], nil
	}
	return nil, errors.New("default channel is not found")
}

func (cm *ChannelManager) isEmpty(key string) bool {
	_, ok := cm.ChannelMap[key]
	return !ok
}
