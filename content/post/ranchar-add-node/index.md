---
title: 已有Rancher集群添加节点
description: 已有Rancher集群添加节点
slug: rancher-add-node
date: 2020-12-04 00:00:00+0000
categories:
    - tech
tags:
    - Kubernetes
draft: false
---

1. 新增节点如果有磁盘则需要挂载磁盘

2. 将k8s的master节点的公钥复制出来在新增的节点

   ```shell
   # 查看公钥
   cat /root/.ssh/id_rsa.pub
   
   # 以下命令在新增节点执行
   # 创建 rancher 用户
   $ useradd rancher
   # 添加到 docker 组
   $ usermod -aG docker rancher
   # 切换到前面创建的用户
   $ su rancher
   # 进入自己的 home 目录
   $ cd ~
   # 创建 .ssh 目录
   $ mkdir .ssh
   # 写入3个服务的公钥
   $ echo "master节点公钥" >> .ssh/authorized_keys
   # 设置权限
   $ chmod 700 .ssh
   $ chmod 644 .ssh/authorized_keys
   ```

   执行完以上操作后可以用master节点连接进行测试

3. 安装集群相同版本的docker

   ```shell
   # 预先设置环境变量VERSION可以指定版本的前缀，如VERSION=18.06 将下载18.06.*的最新版本
   VERSION=18.06
   curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun
   ```
   
4. 没有启动过 docker 的情况下，配置目录还不存在，先创建 `mkdir -p /etc/docker `，然后在 `/data`
   下面创建一个 docker 目录（命令：` mkdir /data/docker `），然后编辑配置文件 `vi /etc/docker/daemon.json` 添加如下配置：

   ```json
   {
   "registry-mirrors": [
   "https://dockerhub.azk8s.cn",
   "https://reg-mirror.qiniu.com"
   ],
   "graph": "/data/docker"
   }
   ```

   然后启动 docker

   ```shell
   # 开机启动
   systemctl enable docker
   # 启动服务
   systemctl start docker
   ```

   

5. 在master节点当中导出rancher相关镜像

```shell
# 导出镜像
docker save $(docker images | grep rancher | awk '{print $1":"$2}') > rancher20201204.tar

# 导入镜像
docker load -i rancher20201204.tar
```



5. 编辑rancher-cluster.yml文件

   ```yaml
   nodes:
    - address: 165.227.114.63
      user: rancher
      role: [controlplane,worker,etcd]
    - address: 165.227.116.167
      user: rancher
      role: [worker]
    - address: 165.227.127.226
      user: rancher
      role: [worker]
    - address: 新节点ip
      user: rancher
      role: [worker]
   services:
    etcd:
     snapshot: true
     creation: 6h
     retention: 24h
   ```

   

6. 在master节点运行

   ```shell
   rke up --update-only --config ./rancher-cluster.yml
   ```

   
