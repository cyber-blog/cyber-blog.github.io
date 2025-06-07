---
title: Java 线程池详解
slug: java-threadpool-details
date: 2025-04-01 00:00:00+0000
categories:
  - tech
tags:
  - Java
draft: false
---
# Java 线程池详解

Java 中的线程池是并发编程中非常重要的一部分，用于提高程序的性能和资源利用率，减少频繁创建和销毁线程的开销。本文将循序渐进地介绍 Java 线程池的构造参数、常见类型及其适用场景，帮助开发者选择和配置合适的线程池。

---

## 一、线程池基础：ThreadPoolExecutor 构造函数

Java 提供了 `ThreadPoolExecutor` 类用于自定义线程池，其构造函数如下：

```java
public ThreadPoolExecutor(
    int corePoolSize,
    int maximumPoolSize,
    long keepAliveTime,
    TimeUnit unit,
    BlockingQueue<Runnable> workQueue,
    ThreadFactory threadFactory,
    RejectedExecutionHandler handler
)
```

### 参数详解

#### 1. corePoolSize（核心线程数）

- 线程池中始终保留的线程数量，即使空闲也不会被销毁。
    
- 当任务提交时，如果当前线程数小于 corePoolSize，会创建新线程处理任务。
    

#### 2. maximumPoolSize（最大线程数）

- 线程池允许的最大线程数量。
    
- 当队列已满且线程数小于 maximumPoolSize 时，线程池会创建新线程处理任务。
    

#### 3. keepAliveTime + unit（空闲线程最大存活时间）

- 非核心线程在空闲时间超过此值时会被回收。
    
- 默认对核心线程无效，可通过 `allowCoreThreadTimeOut(true)` 启用。
    

#### 4. workQueue（任务等待队列）

用于缓存等待执行的任务，常见实现：

| 类型                    | 特点      | 适用场景             |
| --------------------- | ------- | ---------------- |
| ArrayBlockingQueue    | 有界，FIFO | 控制内存使用，防止 OOM    |
| LinkedBlockingQueue   | 默认无界    | 默认队列类型，需防范内存泄漏风险 |
| SynchronousQueue      | 不缓存任务   | 高并发、短任务          |
| PriorityBlockingQueue | 支持任务优先级 | 有优先级需求的场景        |

#### 5. threadFactory（线程工厂）

- 用于自定义线程创建逻辑，如命名、守护线程设置等。
    

```java
new ThreadFactory() {
    private AtomicInteger count = new AtomicInteger(1);
    public Thread newThread(Runnable r) {
        return new Thread(r, "MyThread-" + count.getAndIncrement());
    }
}
```

#### 6. handler（拒绝策略）

- 当线程池和队列已满时，任务提交会触发拒绝策略。
    

|策略类|行为|是否抛异常|
|---|---|---|
|AbortPolicy|抛出异常|✅ 是|
|CallerRunsPolicy|由调用者线程执行|❌ 否|
|DiscardPolicy|直接丢弃任务|❌ 否|
|DiscardOldestPolicy|丢弃队列中最旧的任务|❌ 否|

---

## 二、任务处理流程（简化逻辑）

```
        +------------------------------+
        |  提交任务 executor.execute()   |
        +---------------+--------------+
                        |
                        v
          +-------------+--------------+
          | 当前线程数 < corePoolSize ?  |
          +-------------+--------------+
                        | 是
                        v
          创建线程立即执行任务
                        |
                        否
                        v
          +-------------+--------------+
          | 队列未满？（workQueue）      |
          +-------------+--------------+
                        | 是
                        v
                 放入队列等待
                        |
                        否
                        v
         +--------------+-------------+
         | 当前线程数 < maximumPoolSize ? |
         +--------------+-------------+
                        | 是
                        v
          创建线程立即执行任务
                        |
                        否
                        v
              触发拒绝策略（handler）
```

---

## 三、Executors 提供的线程池工厂方法

除了手动创建线程池，Java 提供了 `Executors` 工具类简化常见线程池的创建方式：

|类型|方法|特点|适用场景|
|---|---|---|---|
|固定线程池|`Executors.newFixedThreadPool(n)`|固定线程数，无界队列|稳定任务量，控制并发|
|缓存线程池|`Executors.newCachedThreadPool()`|无限线程数，空闲线程回收|高并发、短任务|
|单线程池|`Executors.newSingleThreadExecutor()`|单线程顺序执行|日志、事务顺序|
|定时线程池|`Executors.newScheduledThreadPool(n)`|支持定时与周期任务|定时任务处理|
|单线程定时池|`Executors.newSingleThreadScheduledExecutor()`|单线程定时任务|严格顺序定时任务|

### 各线程池使用示例与说明

#### 1. FixedThreadPool

```java
ExecutorService pool = Executors.newFixedThreadPool(4);
```

- 固定线程数，线程不会被销毁。
    
- 使用无界队列，需注意任务积压可能导致 OOM。
    

#### 2. CachedThreadPool

```java
ExecutorService pool = Executors.newCachedThreadPool();
```

- 无限线程创建，适合短期高并发任务。
    
- 使用 `SynchronousQueue`，不会缓存任务。
    

#### 3. SingleThreadExecutor

```java
ExecutorService pool = Executors.newSingleThreadExecutor();
```

- 单线程执行所有任务，保证顺序。
    
- 可用于串行化控制任务执行顺序。
    

#### 4. ScheduledThreadPool

```java
ScheduledExecutorService pool = Executors.newScheduledThreadPool(2);
```

- 支持延迟和周期性执行任务：
    

```java
pool.schedule(task, 1, TimeUnit.SECONDS);
pool.scheduleAtFixedRate(task, 0, 2, TimeUnit.SECONDS);
```

#### 5. SingleThreadScheduledExecutor

```java
ScheduledExecutorService pool = Executors.newSingleThreadScheduledExecutor();
```

- 单线程定时任务调度器，适用于需要顺序和定时的任务。
    

---

## 四、Executors 工厂方法的潜在风险

- FixedThreadPool 和 SingleThreadExecutor 使用 **无界队列**，任务堆积可能导致内存溢出；
    
- CachedThreadPool 最大线程数无限制，线程创建过多可能引发 OOM；
    

### ✅ 推荐实践

> 明确指定线程池参数，避免默认配置带来的不确定性。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    4, 8, 60, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(100),
    Executors.defaultThreadFactory(),
    new ThreadPoolExecutor.AbortPolicy()
);
```

---

## 五、总结与建议

- 对于一般项目，推荐根据任务特性合理配置 ThreadPoolExecutor；
    
- Executors 提供的快捷工厂方法方便但存在默认值陷阱；
    
- 线程池需监控运行状态，避免资源耗尽或任务堆积；
    
- 定期评估线程池的负载情况，调整配置参数。
    

使用线程池是一项系统工程，需要根据任务类型、系统资源、服务目标进行细致规划与调优。