---
title: MacOS自行编译JDK
description: MacOS自行编译JDK
slug: macos-compile-jdk
date: 2022-12-01 00:00:00+0000
image: cover.png
categories:
    - tech
tags:
    - java
draft: false
---

M1 macOS Monterey 12.6 (21G115)
Xcode版本14.0.1

JDK版本17

1. 初始化配置

   ```sh
   bash configure --enable-debug --with-jvm-variants=client,server --disable-warnings-as-errors
   ```

2. 编译
   ```sh
   make
   ```

遇到的坑
https://bugs.openjdk.org/browse/JDK-8272700
https://github.com/tarantool/tarantool/issues/6576
切换为jdk17u-dev之后的问题
https://bugs.openjdk.org/browse/JDK-8283221

详细配置和步骤参考[官网](https://openjdk.org/groups/build/)

Xcode版本过新参考

> Problems with the Build Environment
> Make sure your configuration is correct. Re-run configure, and look for any warnings. Warnings that appear in the middle of the configure output is also repeated at the end, after the summary. The entire log is stored in $BUILD/configure.log.
>
> Verify that the summary at the end looks correct. Are you indeed using the Boot JDK and native toolchain that you expect?
>
> By default, the JDK has a strict approach where warnings from the compiler is considered errors which fail the build. For very new or very old compiler versions, this can trigger new classes of warnings, which thus fails the build. Run configure with --disable-warnings-as-errors to turn of this behavior. (The warnings will still show, but not make the build fail.)
