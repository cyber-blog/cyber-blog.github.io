---
title: Spring Boot应用假死现象：SLF4J日志框架冲突深度分析
description: " 我最近遇到了一个奇怪的现象：在一个 Java Spring Boot 项目开发中，应用启动时显示了一些日志，然后就完全停止输出，程序看起来像是卡住了。控制台光标在闪烁，但是什么都不会发生。"
slug: spring-boot
date: 2024-12-24 00:00:00+0000
categories:
  - tech
tags:
  - Java
  - SpringBoot
draft: false
---
# Spring Boot应用假死现象：SLF4J日志框架冲突深度分析

## 引言

### 一个令人困惑的现象

  我最近遇到了一个奇怪的现象：在一个 Java Spring Boot 项目开发中，应用启动时显示了一些日志，然后就完全停止输出，程序看起来像是卡住了。控制台光标在闪烁，但是什么都不会发生。

  然而，通过排除一个jar包，程序就能正常启动。这让我非常困惑。  为什么排除一个日志相关的依赖就能解决问题？程序真的卡住了吗？

  我将分析我最近遇到的一个真实案例。

## 一、当程序"卡住"的那一刻

  ### 初步现象：程序似乎停止了

  我执行通过IDEA执行`mvn spring-boot:run` 启动应用时，控制台显示了这些信息：

  ```
  SLF4J(W): Class path contains multiple SLF4J providers.
  SLF4J(W): Found provider [org.slf4j.reload4j.Reload4jServiceProvider@64cd705f]
  SLF4J(W): Found provider [org.apache.logging.slf4j.SLF4JServiceProvider@9225652]
  SLF4J(I): Actual provider is of type [org.slf4j.reload4j.Reload4jServiceProvider@64cd705f]
  log4j:WARN No appenders could be found for logger (com.sankuai.inf.octo.mns.util.ProcessInfoUtil).
  log4j:WARN Please initialize the log4j system properly.
  2025-09-19T02:13:23.178052Z main INFO create XMDFileAppender [name=xmdCraneAppender fullFileName=/data/applogs/inf/com.example.com/crane.log appkey=com.example.com fullFilePattern=/data/applogs/inf/com.example.com/crane.log-%d{yyyy-MM-dd}-%i.log]
  2025-09-19T02:13:23.178277Z main INFO create XMDFileAppender [name=xmdMafkaAppender fullFileName=/data/applogs/inf/com.example.com/mafka.log appkey=com.example.com fullFilePattern=/data/applogs/inf/com.example.com/mafka.log-%d{yyyy-MM-dd}-%i.log]
  2025-09-19T02:13:23.178424Z main INFO create XMDFileAppender [name=xmdRhinoAppender fullFileName=/data/applogs/inf/com.example.com/rhino.log appkey=com.example.com fullFilePattern=/data/applogs/inf/com.example.com/rhino.log-%d{yyyy-MM-dd}-%i.log]
  2025-09-19T02:13:23.178563Z main INFO create XMDFileAppender [name=xmdKmsAppender fullFileName=/data/applogs/inf/com.example.com/kms.log appkey=com.example.com fullFilePattern=/data/applogs/inf/com.example.com/kms.log-%d{yyyy-MM-dd}-%i.log]
  2025-09-19T02:13:23.183208Z main INFO Begin Stop AsyncScibeAppender: ScribeAsyncAppender Queue still has 0 events
  2025-09-19T02:13:23.183676Z main INFO End Stop AsyncScibeAppender: ScribeAsyncAppender Queue still has 0 events
  ////////////////////////////////////////////////////////////////////
  //                          _ooOoo_                               //
  //                         o8888888o                              //
  //                         88" . "88                              //
  //                         (| ^_^ |)                              //
  //                         O\  =  /O                              //
  //                      ____/`---'\____                           //
  //                    .'  \\|     |//  `.                         //
  //                   /  \\|||  :  |||//  \                        //
  //                  /  _||||| -:- |||||-  \                       //
  //                  |   | \\\  -  /// |   |                       //
  //                  | \_|  ''\---/''  |   |                       //
  //                  \  .-\__  `-`  ___/-. /                       //
  //                ___`. .'  /--.--\  `. . ___                     //
  //              ."" '<  `.___\_<|>_/___.'  >'"".                  //
  //            | | :  `- \`.;`\ _ /`;.`/ - ` : | |                 //
  //            \  \ `-.   \_ __\ /__ _/   .-` /  /                 //
  //      ========`-.____`-.___\_____/___.-`____.-'========         //
  //                           `=---='                              //
  //      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^        //
  //            佛祖保佑       永不宕机      永无BUG                   //
  //            Thanks to Buddha's blessing, may our system         //
  //            remain stable and bug-free forever.                 //
  ////////////////////////////////////////////////////////////////////
  9月 19, 2025 10:13:26 上午 org.bouncycastle.jsse.provider.PropertyUtils getStringSecurityProperty
  信息: Found string security property [jdk.tls.disabledAlgorithms]: SSLv3, TLSv1, TLSv1.1, RC4, DES, MD5withRSA, DH keySize < 1024, EC keySize < 224, 3DES_EDE_CBC, anon, NULL
  9月 19, 2025 10:13:26 上午 org.bouncycastle.jsse.provider.PropertyUtils getStringSecurityProperty
  信息: Found string security property [jdk.certpath.disabledAlgorithms]: MD2, MD5, SHA1 jdkCA & usage TLSServer, RSA keySize < 1024, DSA keySize < 1024, EC keySize < 224, SHA1 usage SignedJAR & denyAfter 2019-01-01
  9月 19, 2025 10:13:26 上午 org.bouncycastle.jsse.provider.DisabledAlgorithmConstraints create
  警告: Ignoring unsupported entry in 'jdk.certpath.disabledAlgorithms': SHA1 jdkCA & usage TLSServer
  9月 19, 2025 10:13:26 上午 org.bouncycastle.jsse.provider.DisabledAlgorithmConstraints create
  警告: Ignoring unsupported entry in 'jdk.certpath.disabledAlgorithms': SHA1 usage SignedJAR & denyAfter 2019-01-01
  2025-09-19T02:13:26.632017Z xmdlog-registry-service INFO Registry LogManager register status true, url : http://log.inf.dev.sankuai.com/api/register?appkey=com.example.com&ip=172.18.151.200&port=12315&env=TEST&version=2.2.0
  Local Appenv: deployenv [qa], env [test]
  AppEnv{deployenv='qa', env='test', swimlane='tmp-test', cell='null', grouptags='null'}
  Fri Sep 19 10:13:48 CST 2025 WARN: Establishing SSL connection without server's identity verification is not recommended. According to MySQL 5.5.45+, 5.6.26+ and 5.7.6+ requirements SSL connection must be established by default if explicit option isn't set. For compliance with existing applications not using SSL the verifyServerCertificate property is set to 'false'. You need either to explicitly disable SSL by setting useSSL=false, or set useSSL=true and provide truststore for server certificate verification.
  ```

  在显示了一些组件初始化信息和ASCII图案后，程序就完全停止输出了。控制台光标在闪烁，但是什么都不会发生。

## 二、真相往往出人意料

  ### 数字不会说谎：56.7%的CPU使用率

  首先使用 `ps` 命令查看进程信息：

  ```bash
  $ ps aux | grep ApplicationLoader
  majiang    97897  56.7  2.5 443940128 633216   ??  R    11:34AM   1:19.25
  ```

  这个结果让我震惊：
  - 进程状态: R (Running) — 程序在运行，不是阻塞状态
  - CPU使用率: 56.7% — 程序在积极工作
  - 运行时间: 1小时19分钟 — 程序一直在持续运行

  我原本以为程序卡住了，如果真是这样，CPU使用率应该接近0%。但现在56.7%的CPU使用率说明程序在正常运行！

  ### 深入检查：使用各种分析工具

  为了彻底搞清楚程序在做什么，我使用了多种分析手段：

  线程状态分析: 使用`jstack`反复检查，没有发现死锁或异常阻塞

- Profiler火焰图: 通过JProfiler查看方法调用，程序执行正常

- 线程时间线: 观察线程的时间分布，各个线程都在正常工作

- 线程快照: 多次获取线程快照对比，线程状态正常工作

  所有这些工具都指向同一个结论：程序运行完全正常，没有任何阻塞或性能问题。

  进一步分析线程堆栈，我发现了关键信息：
```bash
  $ jstack 97897 | grep -E "main.*tid"
  # 没有找到main线程！

  $ jstack 97897 | head -20
  "qtp1366921090-106" #106 prio=5 ... waiting on condition
  "qtp1366921090-107" #107 prio=5 ... runnable  
  "RhinoHttpSeverBossGroup-2-1" #128 prio=5 ... runnable
  "MtthriftServerBossGroup-8-1" #346 prio=5 ... runnable
  "DestroyJavaVM" #377 prio=5 ... waiting on condition
```
  这些发现彻底改变了我的认知：

  - ✅ Main线程已经正常执行完毕并退出
  - ✅ Spring Boot应用完全启动成功
  - ✅ HTTP服务器线程池（qtp开头的线程）在正常运行
  - ✅ 各种服务组件的工作线程都在运行

  程序根本没有"卡住"！

  真正发生的是：应用在后台正常运行，但是没有任何日志输出。这给我造成了程序停止响应的错觉。

  问题的本质从"程序阻塞"变成了"日志系统失效"。

 ## 三、静默杀手的真面目

  ### SLF4J的选择困难症

  既然程序正常运行但没有日志输出，问题就出在日志系统上。回看最初的警告信息：

```
  SLF4J(W): Class path contains multiple SLF4J providers.
  SLF4J(W): Found provider [org.slf4j.reload4j.Reload4jServiceProvider@64cd705f]
  SLF4J(W): Found provider [org.apache.logging.slf4j.SLF4JServiceProvider@9225652]
  SLF4J(I): Actual provider is of type [org.slf4j.reload4j.Reload4jServiceProvider@64cd705f]
```

  这里揭示了关键问题：**SLF4J在两个日志实现之间选择了错误的那个**。

  `SLF4J`是一个日志门面，它在运行时从classpath中选择一个具体的日志实现。选择策略很简单：使用第一个发现的提供者。

  **两个冲突的提供者**：
  - `org.slf4j.reload4j.Reload4jServiceProvider` — 来自`slf4j-reload4j`包，兼容Log4j 1.x
  - `org.apache.logging.slf4j.SLF4JServiceProvider` — 来自`log4j-slf4j2-impl`包，支持Log4j 2.x

  SLF4J选择了reload4j提供者，但我的项目配置的是Log4j 2.x格式。

  ### 被吞噬的日志去了哪里

  我的项目使用的是标准的Log4j 2.x配置文件：

  ```xml
  <configuration status="info">
      <appenders>
          <Console name="Console" target="SYSTEM_OUT">
              <PatternLayout pattern="${sys:CONSOLE_LOG_PATTERN}" />
          </Console>
          <XMDFile name="infoAppender" fileName="info.log">
              <!-- Log4j 2.x特有的appender -->
          </XMDFile>
      </appenders>
      <loggers>
          <root level="info">
              <appender-ref ref="Console"/>
          </root>
      </loggers>
  </configuration>
  ```

  问题在于：reload4j只能理解Log4j 1.x的配置格式，无法解析Log4j 2.x的高级语法。

  失败链路：
  1. reload4j尝试解析log4j2.xml
  2. 遇到不认识的`<XMDFile>`等Log4j 2.x元素
  3. 配置解析失败，没有创建任何appender
  4. 所有日志调用都被静默丢弃

  这就是为什么会出现这个警告：
 ```
 log4j:WARN No appenders could be found for logger (com.sankuai.inf.octo.mns.util.ProcessInfoUtil).
 log4j:WARN Please initialize the log4j system properly.
 ```

  完整的"吞噬"过程：

```shell
  第1步: 业务代码调用
  logger.info("Spring Boot application started")
      ↓
  第2步: SLF4J门面接收调用
  org.slf4j.Logger.info(String msg)
      ↓
  第3步: SLF4J路由到选中的提供者
  SLF4J → org.slf4j.reload4j.Reload4jLoggerAdapter
      ↓
  第4步: reload4j适配器委托给Log4j 1.x
  Reload4jLoggerAdapter → org.apache.log4j.Logger (reload4j实现)
      ↓
  第5步: Log4j检查可用的appender
  logger.getAllAppenders() → 返回空集合 (因为配置解析失败)
      ↓
  第6步: 没有appender可用
  Log4j判断：既然没有appender，就直接丢弃这条消息
      ↓
  第7步: 静默返回
  方法正常返回，不抛异常，业务代码继续执行
      ↓
  结果: 用户完全看不到任何日志输出
```

  Log4j采用"静默失败"策略：当没有可用的appender时，所有日志调用正常执行但输出被完全丢弃，不会抛出异常影响业务逻辑。

  这就是为什么排除slf4j-reload4j能解决问题：去掉错误的提供者后，SLF4J会选择正确的Log4j 2.x实现，日志系统恢复正常。

## 四、破解之道

  ### 斩断混乱的依赖链

  理解了问题本质后，解决方案就很清楚了：**消除SLF4J提供者冲突**。

  通过Maven依赖排除，将错误的提供者从classpath中移除：

  ```xml
  <dependency>
      <groupId>com.sankuai.com</groupId>
      <artifactId>example-sdk</artifactId>
      <version>1.0</version>
      <exclusions>
          <exclusion>
              <artifactId>slf4j-reload4j</artifactId>
              <groupId>org.slf4j</groupId>
          </exclusion>
      </exclusions>
  </dependency>
  ```

  修复后的效果：
  1. Classpath中只剩下log4j-slf4j2-impl提供者
  2. SLF4J自动选择Log4j 2.x实现
  3. Log4j 2.x正确解析log4j2.xml配置文件
  4. Console和File appender正常创建
  5. 日志输出恢复正常，应用"复活"

  验证修复结果：
  ```
  2025-09-19 10:37:00.840  INFO 62045 --- [           main] c.s.h.g.g.ApplicationLoader              : Starting ApplicationLoader using Java 17.0.10
  2025-09-19 10:37:00.840  INFO 62045 --- [           main] c.s.h.g.g.ApplicationLoader              : The following 1 profile is active: "test"
  2025-09-19 10:37:15.234  INFO 62045 --- [           main] c.s.h.g.g.ApplicationLoader              : Started ApplicationLoader in 14.628 seconds
  ```

  没有了SLF4J警告信息，没有了log4j的错误提示，一切都恢复正常。

 ### 为什么会一直使用reald4j?

通过查看项目的pom.xml文件，我发现`photo-thrift-client`依赖的位置确实影响了SLF4J提供者的选择。

  在`hrmdm-globaldata-gateway-infrastructure/pom.xml`中，`photo-thrift-client`依赖位于：

  ```xml
  <dependency>
      <groupId>com.sankuai.com</groupId>
      <artifactId>example-sdk</artifactId>
      <version>1.0</version>
      <exclusions>
          <exclusion>
              <artifactId>slf4j-reload4j</artifactId>
              <groupId>org.slf4j</groupId>
          </exclusion>
      </exclusions>
  </dependency>
  ```

  这个依赖在文件中的位置相对较前，而且它直接引入了slf4j-reload4j作为传递依赖。由于Maven构建classpath时按照依赖在文件中的声明顺序，slf4j-reload4j的ServiceProvider文件被先加载到ServiceLoader中。

  具体的加载顺序：
  1. Maven解析依赖树，photo-thrift-client较早被处理
  2. photo-thrift-client → slf4j-reload4j 被添加到classpath靠前位置
  3. ServiceLoader扫描时，先发现slf4j-reload4j的ServiceProvider
  4. SLF4J选择第一个发现的提供者：reload4j

  这就是为什么slf4j-reload4j被优先选择的根本原因。不同的项目中，如果依赖声明顺序不同，可能就会选择log4j-slf4j2-impl作为提供者。

  验证方法：

 ```shell
 mvn dependency:build-classpath
 ```

  可以查看实际构建的classpath顺序，确认slf4j-reload4j确实在前面。


  ## 尾声：技术世界的启示

这个案例揭示了现代Java应用生态的复杂性。一个看似无害的传递依赖，通过微妙的类加载顺序和配置不匹配，导致了整个日志系统的静默失效。

  **表象具有欺骗性**。当我最初看到程序"卡住"时，直觉告诉我这是一个阻塞或死锁问题。但深入分析后发现，程序运行完全正常，问题出在一个完全不同的地方。

  **工具是解决问题的关键**。通过系统命令（ps、jstack）和分析工具，我能够透过现象看到本质，发现程序实际在正常运行。

  **依赖管理的重要性**。在现代Java项目中，传递依赖可能带来意想不到的问题。一个小小的jar包冲突，就能让整个应用的行为变得诡异。

  **静默失败的双刃剑**。Log4j的静默失败设计保护了业务逻辑，但也让问题变得更难发现。有时候，适当的"噪音"比安静的错误更有价值。

  最重要的是：**不要被第一印象误导**。技术问题往往比表面现象更复杂，也更有趣。当遇到无法理解的现象时，保持好奇心，深入挖掘，往往会发现令人惊喜的真相。

  在复杂的技术世界里，最神秘的故障背后，可能隐藏着最简单的原理。