---
title: Docker构建Freeswitch并部署
description: 简要叙述 Docker 部署 Freeswitch 的过程
slug: fs-install4docker
date: 2022-10-09 00:00:00+0000
image: cover2.jpg
categories:
    - tech
tags:
    - FreeSWITCH
draft: false
---
随着生产环境ubuntu系统的更新。`FreeSWITC`1.6版本的安装和部署所依赖的一些库已经不兼容或不存在，导致安装会出现一些问题。为解决这些问题`FreeSWITC`的版本也需要升级。并且使用Docker的方式部署和安装。

## 构建镜像

1. clone freeswitch repository

   ```sh
   git clone https://github.com/signalwire/freeswitch.git
   ```

2. 进入`freeswitch`官网申请账号并获取自己账号的`TOKEN`。参考[官方文档](https://freeswitch.org/confluence/display/FREESWITCH/HOWTO+Create+a+SignalWire+Personal+Access+Token)

3. 修改`Dockerfile`。包括修改`TOKEN`和添加`apt-get`国内源等。参考如下

   ```dockerfile
   # vim:set ft=dockerfile:
   ARG DEBIAN_VERSION=buster
   FROM debian:${DEBIAN_VERSION}
   ARG TOKEN=YOU_TOKEN
   
   # Source Dockerfile:
   # https://github.com/docker-library/postgres/blob/master/9.4/Dockerfile
   
   # explicitly set user/group IDs
   RUN groupadd -r freeswitch --gid=999 && useradd -r -g freeswitch --uid=999 freeswitch
   
   RUN apt-get update && apt-get install -y ca-certificates && sed -i 's#http://deb.debian.org#https://mirrors.163.com#g' /etc/apt/sources.list && apt-get clean
   
   # grab gosu for easy step-down from root
   RUN apt-get update && apt-get install -y --no-install-recommends dirmngr gnupg2 wget \
       && gpg2 --keyserver hkp://keyserver.ubuntu.com --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4 \
       && gpg2 --keyserver hkp://keyserver.ubuntu.com --recv-keys 655DA1341B5207915210AFE936B4249FA7B0FB03 \
       && gpg2 --output /usr/share/keyrings/signalwire-freeswitch-repo.gpg --export 655DA1341B5207915210AFE936B4249FA7B0FB03 \
       && rm -rf /var/lib/apt/lists/* \
       && wget -O /usr/local/bin/gosu "https://github.com/tianon/gosu/releases/download/1.2/gosu-$(dpkg --print-architecture)" \
       && wget -O /usr/local/bin/gosu.asc "https://github.com/tianon/gosu/releases/download/1.2/gosu-$(dpkg --print-architecture).asc" \
       && gpg --verify /usr/local/bin/gosu.asc \
       && rm /usr/local/bin/gosu.asc \
       && chmod +x /usr/local/bin/gosu \
       && apt-get purge -y --auto-remove wget dirmngr gnupg2
   
   # make the "en_US.UTF-8" locale so freeswitch will be utf-8 enabled by default
   RUN apt-get update && apt-get install -y locales && rm -rf /var/lib/apt/lists/* \
       && localedef -i en_US -c -f UTF-8 -A /usr/share/locale/locale.alias en_US.UTF-8
   ENV LANG en_US.utf8
   
   # https://freeswitch.org/confluence/display/FREESWITCH/Debian
   
   RUN apt-get update && apt-get install lsb-release -y --no-install-recommends \
       && echo "machine freeswitch.signalwire.com login signalwire password ${TOKEN}" > /etc/apt/auth.conf \
       && echo "deb [signed-by=/usr/share/keyrings/signalwire-freeswitch-repo.gpg] https://freeswitch.signalwire.com/repo/deb/debian-release/ `lsb_release -sc` main" > /etc/apt/sources.list.d/freeswitch.list \
       && apt-get update && apt-get install -y freeswitch-all \
       && apt-get purge -y --auto-remove ca-certificates lsb-release \
       && apt-get clean && rm -rf /var/lib/apt/lists/*
   
   COPY docker-entrypoint.sh /
   # Add anything else here
   
   ## Ports
   # Open the container up to the world.
   ### 8021 fs_cli, 5060 5061 5080 5081 sip and sips, 64535-65535 rtp
   EXPOSE 8021/tcp
   EXPOSE 5060/tcp 5060/udp 5080/tcp 5080/udp
   EXPOSE 5061/tcp 5061/udp 5081/tcp 5081/udp
   EXPOSE 7443/tcp
   EXPOSE 5070/udp 5070/tcp
   EXPOSE 64535-65535/udp
   EXPOSE 16384-32768/udp
   
   
   # Volumes
   ## Freeswitch Configuration
   VOLUME ["/etc/freeswitch"]
   ## Tmp so we can get core dumps out
   VOLUME ["/tmp"]
   
   # Limits Configuration
   COPY    build/freeswitch.limits.conf /etc/security/limits.d/
   
   # Healthcheck to make sure the service is running
   SHELL       ["/bin/bash"]
   HEALTHCHECK --interval=15s --timeout=5s \
       CMD  fs_cli -x status | grep -q ^UP || exit 1
   
   ENTRYPOINT ["/docker-entrypoint.sh"]
   
   
   CMD ["freeswitch"]
   ```

4. 进入`docker/master`目录执行构建命令

   ```sh
   docker build -t freeswitch .
   ```

## 配置文件修改

1. 修改启动映射的端口号

2. 修改日志输出位置

3. 修改ESL监听映射配置

   修改`event_socket.conf`

   ```xml
   <configuration name="event_socket.conf" description="Socket Client">
     <settings>
       <param name="nat-map" value="false"/>
       <!-- 配置为0.0.0.0代表指定IPV4的所有IP地址链接  -->
       <param name="listen-ip" value="0.0.0.0"/>
       <param name="listen-port" value="8021"/>
       <param name="password" value="ClueCon"/>
       <!-- 表示使用acl名称为lan的集合进行IP校验 -->
       <param name="apply-inbound-acl" value="lan"/>
       <!--<param name="stop-on-bind-error" value="true"/>-->
     </settings>
   </configuration>
   ```

   修改`acl.conf.xml`

   ```xml
   <configuration name="acl.conf" description="Network Lists">
     <network-lists>
       <!--
   	 These ACL's are automatically created on startup.
   
   	 rfc1918.auto  - RFC1918 Space
   	 nat.auto      - RFC1918 Excluding your local lan.
   	 localnet.auto - ACL for your local lan.
   	 loopback.auto - ACL for your local lan.
       -->
   
       <list name="lan" default="allow">
         <node type="deny" cidr="192.168.42.0/24"/>
         <node type="allow" cidr="192.168.42.42/32"/>
         <node type="allow" cidr="121.28.78.50/32">
       </list>
   
       <!--
   	This will traverse the directory adding all users
   	with the cidr= tag to this ACL, when this ACL matches
   	the users variables and params apply as if they
   	digest authenticated.
       -->
       <list name="domains" default="deny">
         <!-- domain= is special it scans the domain from the directory to build the ACL -->
         <node type="allow" domain="$${domain}"/>
         <!-- use cidr= if you wish to allow ip ranges to this domains acl. -->
         <!-- <node type="allow" cidr="192.168.0.0/24"/> -->
       </list>
   
     </network-lists>
   </configuration>
   ```

   



## 启动容器

运行命令。注意端口和数据卷的映射

```sh
# 一部分RTP端口的映射需要占用大量的启动时间。直接使用--net=host参数
docker run -it --name freeswitch \
           -v /data/freeswitch/configuration:/etc/freeswitch \
           -v /data/freeswitch/tmp:/tmp \
           -v /data/freeswitch/log:/log \
           --net host \
           majiang213/freeswitch
```

