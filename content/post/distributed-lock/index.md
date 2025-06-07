---
title: 分布式锁的实现原理与方式详解
slug: dataset-upload2hugginface
date: 2025-06-07 00:00:00+0000
categories:
  - tech
tags:
  - 架构
  - Redis
  - Zookeeper
draft: false
---
# 分布式锁的实现原理与方式详解

## 一、基于 Redis 的分布式锁实现

Redis 是目前使用最广泛的分布式锁方案之一，通常通过如下命令实现：

```shell
SET lock_key unique_id NX PX 30000
```

### 参数说明

- `lock_key`：**键（Key）**，表示分布式锁在 Redis 中的标识名；
    
- `unique_id`：**值（Value）**，代表当前请求加锁的客户端唯一标识（例如 UUID + ThreadID），用于确保释放锁时身份验证；
    
- `NX`：表示仅在键不存在时才进行设置，防止覆盖其他客户端已持有的锁；
    
- `PX 30000`：设置键的过期时间为 30 秒，防止因客户端异常退出而产生死锁。
    

### 加锁失败的返回值

如果 `lock_key` 已存在，说明已有其他线程持有锁，命令将返回 `null`，表示加锁失败。

### 解锁 Lua 脚本示例

```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```

该脚本判断当前请求者是否为锁的持有者（通过比对 `unique_id`），只有持有者才能安全释放锁。

---

## 二、基于 Redisson 的分布式锁实现

Redisson 是 Redis 官方推荐的 Java 客户端之一，封装了丰富的分布式对象，其中对分布式锁的支持较为完整。

### 主要特性

- 支持可重入锁（同一线程可多次加锁）；
    
- Watchdog 自动续期机制，防止锁自动过期；
    
- Lua 脚本保障操作原子性；
    
- 支持公平锁、读写锁、联锁等高级功能。
    

### 加锁 Lua 脚本

```lua
if (redis.call('exists', KEYS[1]) == 0) then
  redis.call('hset', KEYS[1], ARGV[2], 1);
  redis.call('pexpire', KEYS[1], ARGV[1]);
  return nil;
end;

if (redis.call('hexists', KEYS[1], ARGV[2]) == 1) then
  redis.call('hincrby', KEYS[1], ARGV[2], 1);
  redis.call('pexpire', KEYS[1], ARGV[1]);
  return nil;
end;

return redis.call('pttl', KEYS[1]);
```

- 使用 Hash 存储锁持有者及重入次数；
    
- `ARGV[2]` 为唯一标识（如线程 ID）；
    
- 若当前线程已持有锁，则重入计数 +1 并续期。
    

### 解锁 Lua 脚本

```lua
if (redis.call('hexists', KEYS[1], ARGV[1]) == 0) then
  return nil;
end;

local counter = redis.call('hincrby', KEYS[1], ARGV[1], -1);
if (counter > 0) then
  redis.call('pexpire', KEYS[1], ARGV[2]);
  return 0;
else
  redis.call('del', KEYS[1]);
  return 1;
end;
```

- 减少持有者的重入计数；
    
- 若减为 0，释放锁。
    

### Watchdog 自动续期机制

- 默认锁的 TTL 为 30 秒；
    
- 若未显式设置 TTL，Redisson 会启动“看门狗”线程，每隔 10 秒自动续期，直至业务逻辑完成；
    
- 避免因执行时间较长导致锁意外过期。
    

### Java 使用示例

```java
RLock lock = redissonClient.getLock("myLock");
try {
    if (lock.tryLock(5, 30, TimeUnit.SECONDS)) {
        // 执行业务逻辑
    }
} finally {
    if (lock.isHeldByCurrentThread()) {
        lock.unlock();
    }
}
```

---

## 三、Lua 脚本为何具备原子性？

### 核心机制

Redis 执行 Lua 脚本时具备以下特性：

- Redis 使用单线程模型；
    
- `EVAL` 命令整体作为一个事务执行；
    
- 执行脚本期间不会响应其他客户端请求；
    
- 脚本内部多个 Redis 命令会被整体提交执行，无法被打断。
    

因此，在 Redis 中执行 Lua 脚本具有天然的原子性，能够有效避免竞态条件。

---

## 四、分布式锁的其他实现方式

### 1. 基于数据库（如 MySQL/PostgreSQL）

#### 实现方式

- 利用唯一约束：`INSERT INTO lock_table (key) VALUES ('lockKey')`；
    
- 或使用悲观锁：`SELECT ... FOR UPDATE`。
    

#### 优缺点

- **优点**：实现简单、依赖较少、与业务数据库一致性强；
    
- **缺点**：性能较差，不适合高并发场景，可能引发死锁或阻塞。
    

### 2. 基于 ZooKeeper 的分布式锁

#### 实现方式

- 利用临时顺序节点（`Ephemeral Sequential`）；
    
- 所有客户端在某节点下创建顺序子节点；
    
- 排序最小的节点获得锁，其他客户端监听前一个节点。
    

#### 优缺点

- **优点**：可靠性高、天然支持顺序和事件通知机制；
    
- **缺点**：部署复杂、性能受限于 ZooKeeper 的吞吐能力。
    

### 3. 基于 Etcd 的分布式锁

#### 实现方式

- 利用 Etcd 的租约（Lease）和事务（Txn）；
    
- 客户端通过 CAS 机制创建唯一锁键，并绑定租约；
    
- 续期机制保障锁的持有。
    

#### 优缺点

- **优点**：一致性强、适用于容器编排等场景；
    
- **缺点**：相对复杂，需要管理租约续期和连接状态。
    

---

## 五、小结

|实现方式|优点|缺点|
|---|---|---|
|Redis|高性能、实现简单、生态丰富|容易出现锁失效或误删|
|Redisson|功能丰富、支持自动续期|相对重量级，需客户端支持|
|数据库|简单易用、无需引入中间件|性能瓶颈明显，存在死锁风险|
|ZooKeeper|高可靠性、顺序性好|部署复杂、性能有限|
|Etcd|一致性强、支持租约机制|运维成本高，使用门槛较高|

选择分布式锁实现方案时，应根据系统性能需求、可靠性要求和技术栈综合考虑。