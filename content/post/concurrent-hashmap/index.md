---
title: ConcurrentHashMap 内部解析
description: ConcurrentHashMap 是如何保证线程安全的，JDK1.7 - 1.8 之间做了什么优化
slug: ca-manage
date: 2020-04-01 00:00:00+0000
image: cover.png
categories:
  - tech
tags:
  - Java
draft: true
---
# **JDK7→JDK8 架构演进**

JDK7 版本的 ConcurrentHashMap 采用分段锁（Segment）设计：底层有一个 Segment[] 数组，每个 Segment 继承自 ReentrantLock，默认并发度 16，多个线程可并发操作不同段 。相比之下，JDK8 取消了 Segment，直接使用一个 Node<K,V>[] table 数组＋链表（或红黑树）结构，**桶级别加锁**，并采用 CAS 算法保证线程安全 。换言之，JDK8 将锁的粒度细化到每个桶（Hash 链表/树）的头结点（Node 或 TreeBin），并用内置 synchronized + CAS 实现高并发控制 。这一演进动机是通过更细粒度的无锁或局部锁设计，提高并发度，充分利用多核 CPU 资源。正如社区所述：“JDK8 中 ConcurrentHashMap 的高并发是通过 CAS 乐观锁 + 自旋锁 + 细粒度 加锁保证的” 。总体而言，HashTable→JDK7 CHM（Segment）→JDK8 CHM 是同步串行→分段并发→极细粒度并发的演进 。

  

_图：ConcurrentHashMap JDK8 中的桶结构，每个槽位要么为空，要么为链表，要么为红黑树_ _。_

  

## **主数据结构**

  

JDK8 ConcurrentHashMap 的核心字段是 **transient volatile Node<K,V>[] table** 。其中 Node 为基本存储单元，其结构与 HashMap.Entry 类似：包含 final int hash、final K key 两个不可变字段，以及 volatile V val 和 volatile Node<K,V> next（指向链表的下一个节点） 。例如源码片段：

```
static class Node<K,V> implements Map.Entry<K,V> {
    final int hash;
    final K key;
    volatile V val;
    volatile Node<K,V> next;
    // 构造器、equals/hashCode、find等省略……
}
```

因为 table 是 volatile，保证了对数组引用的可见性；而数组内部元素的更新则通过 Unsafe 原子操作（参见下文）保证多线程可见性和原子性。

  

当哈希冲突较多时，JDK8 引入了红黑树优化：当一个桶中链表长度超过阈值 TREEIFY_THRESHOLD（默认 8），且整个表容量大于 MIN_TREEIFY_CAPACITY（默认 64），则会将该链表转换为 TreeBin 包装的红黑树结构 。对应的常量定义如下：

```
static final int TREEIFY_THRESHOLD = 8;
static final int UNTREEIFY_THRESHOLD = 6;
static final int MIN_TREEIFY_CAPACITY = 64;
```

当树结构不再需要（节点变少至 UNTREEIFY_THRESHOLD 以下）时，也会“退化”回链表。这样做的动因是：在哈希冲突严重时，通过树结构将查询从 O(n) 降至 O(log n)，提升查找效率，同时依然保证线程安全转换 。

  

## **CAS 原理与失败处理**

  

ConcurrentHashMap 大量使用 CAS（Compare-And-Swap）原子操作来实现无锁更新。核心实现在 Unsafe 类：比如 casTabAt(Node[] tab, i, expect, update) 实际调用 Unsafe.compareAndSwapObject，背后对应 CPU 的原子指令（x86 上是 LOCK CMPXCHG） 。这条指令会对比内存中位置的当前值与预期值，若相等则写入新值，否则操作失败，且本操作会序列化当前 CPU 的所有未决载入/存储（即完整内存屏障） 。因此，CAS 不仅能保证原子性，还隐含了内存屏障效果。

**CAS 使用实例：** 当某桶位为空时，写线程首先尝试 casTabAt(tab, index, null, newNode)，只要判断期望值为 null（即当前无其他节点）就原子插入新节点 。如果 CAS 成功，则无需加锁即可完成插入；如果 CAS 失败（说明其它线程已插入），则会重试或最终进入同步分支。一般而言，CAS 失败意味着某线程更新了当前内存值，这时当前线程会重新加载节点并再试。对于复杂操作（如链表末尾插入或树操作），如果 CAS 重试多次仍失败，则回退到 synchronized 锁定头节点以串行化安全插入 。

**CPU 内存屏障：** 在 x86 架构上，LOCK CMPXCHG 指令本身会产生完整内存屏障 。此外，JDK 的 volatile 关键字也会在读/写时自动插入内存屏障：对于 volatile 写，会在写操作后插入一个 Store 屏障，将修改后的值刷新到主内存；对于 volatile 读，会在读操作前插入一个 Load 屏障，从主内存重新加载变量 。因此，在 ConcurrentHashMap 中，重要字段（table、nextTable、sizeCtl 等）均被声明为 volatile ，确保读写操作在不同线程间可见。简而言之，CAS 保证原子更新，volatile 保证可见性，两者配合实现了高效的无锁/局部锁并发控制 。

  

## **同步锁定（桶级别）**

尽管多数读操作无锁，**写操作会在必要时对桶头加锁**以保证安全。在 JDK8 中，ConcurrentHashMap 不再使用 ReentrantLock，而是直接在桶头节点 f 上使用 synchronized(f)。例如，在 putVal 中，如果定位到某个非空桶头 f，代码会执行：

```
synchronized (f) {
    if (tabAt(tab,i) == f) {
        // ... 在桶中做插入或更新
    }
}
```

这意味着仅锁定了单个桶（即对该链表或树的头节点加锁），而不会阻塞其他桶的操作 。锁内部还做了“双重检测”：锁后再次检查 tab[i] 是否仍为 f，以防插入过程中其它线程已经变更了该桶。这种细粒度锁避免了全表加锁，允许其他线程并发访问或修改不同槽位，极大地提升并发性能 。

  

## **volatile**

##  **与内存屏障**

  

除了 CAS 原语，ConcurrentHashMap 在关键字段上使用 volatile 来满足 Java 内存模型（JMM）的可见性需求。例如，table、nextTable、sizeCtl 等都是 volatile。需要注意的是，volatile 保证的是对字段本身的可见性和有序性，但数组元素（如 table[i]）并非自动具有 volatile 语义，因此对于节点数组的读写也要通过 Unsafe 提供的 getObjectVolatile/putObjectVolatile 或者 CAS 方法，来保证跨线程的可见性 。

  

内存屏障层面，Java 在 volatile 写后插入 Store 屏障、在 volatile 读前插入 Load 屏障 。这使得写线程对共享变量的写操作会立即对其他线程可见，读线程也会获得最新值。配合 CAS 原语内建的锁前/锁后屏障，ConcurrentHashMap 的实现确保在多核环境下的修改不会被乱序执行影响 。

## **并发控制流程（源码级分析）**

  

### 🟩 读取操作 (get)

读取过程是无锁的。get(key) 首先通过 key.hashCode() 和扰动函数计算出槽位索引 i，再通过 tabAt(table, i) 获取桶头节点 Node<K,V> e。

由于 table 是 volatile 修饰，保证了在多线程环境下读取的可见性，而桶内节点在并发环境中也不会出现结构破坏。主要原因是写操作会加锁，而读操作只是顺序遍历链表或树，读取的是某一时刻的“快照”。

```
final Node<K,V>[] tab;
Node<K,V> e;
int n, i;

if ((tab = table) != null && (n = tab.length) > 0 &&
    (e = tabAt(tab, i = (n - 1) & hash)) != null) {
    if (e.hash == hash && ((ek = e.key) == key || (ek != null && key.equals(ek))))
        return e.val;
    // 遍历链表
    Node<K,V> p = e.next;
    while (p != null) {
        if (p.hash == hash && ((pk = p.key) == key || (pk != null && key.equals(pk))))
            return p.val;
        p = p.next;
    }
}
```

> 在遍历过程中，如果有线程正在插入或删除节点，也不会破坏结构：尾插法插入不会影响当前链表遍历，而删除只是修改前驱节点的 next 指针，不会中断链表。

  

结论：get 操作是线程安全的，只是不保证读到的是最新值（**弱一致性**）。

---

### 🟥 写入操作 (put)

  

putVal(key, value) 是线程安全实现的核心，其控制流程包括初始化、定位桶位、加锁/插入、扩容触发等步骤：

  

#### **1. 初始化表（懒加载）**

  

当 table == null 时，使用 CAS 操作进行初始化，防止多线程同时初始化。

```
if ((tab = table) == null || (n = tab.length) == 0)
    tab = initTable(); // 内部使用 CAS 保证仅一个线程初始化
```

> sizeCtl 被设置为 -1 表示有线程正在初始化，其他线程会自旋等待。

---

#### **2. 定位桶位并插入**

  

根据哈希值计算槽位索引 i = (n - 1) & hash，检查该槽是否为空：

- 若为空，直接使用 CAS 插入，无需加锁：
    

```
if ((f = tabAt(tab, i)) == null) {
    if (casTabAt(tab, i, null,
        new Node<K,V>(hash, key, val, null)))
        break; // 插入成功
}
```

- 若该槽正在扩容（即头节点为 MOVED），当前线程会参与扩容协助：
    

```
else if (f.hash == MOVED) {
    tab = helpTransfer(tab, f);
}
```

- 否则说明该槽已有节点（链表或树），则使用 synchronized(f) 加锁处理：
    

```
synchronized (f) {
    if (tabAt(tab, i) == f) {
        if (f instanceof TreeBin) {
            // 插入红黑树
            ((TreeBin<K,V>)f).putTreeVal(hash, key, val);
        } else {
            // 插入链表尾部或更新
            for (binCount = 1, e = f;; ++binCount) {
                if (e.hash == hash && (e.key.equals(key))) {
                    e.val = val;
                    break;
                }
                if ((pred = e).next == null) {
                    pred.next = new Node<>(hash, key, val, null);
                    break;
                }
                e = e.next;
            }
        }
    }
}
```

> 插入完成后，如果链表长度超过阈值（默认为 8），会触发树化。

---

#### **3. 插入后扩容检查**

  

每次插入完成后调用 addCount() 更新元素计数，必要时触发扩容。

```
addCount(1L, binCount);
```

如果当前节点总数超过 sizeCtl 阈值，某个线程会创建 nextTable 并发起扩容，其余线程则协助迁移数据。

---

#### **4. 迁移过程（线程协作扩容）**

  

扩容操作由多个线程协作完成，通过共享变量 transferIndex 将旧表按段分配：

```
int stride = (n > NCPU) ? (n >>> 3) / NCPU : n;
transferIndex = n; // 从高位向低位迁移
```

每个线程 CAS 争抢 transferIndex 段并迁移桶内容。迁移逻辑如下：

- 节点按 hash 决定是否保留原索引或转移至新表中的 i + oldCap
    
- 若槽位已迁移完成，插入一个 ForwardingNode 作为占位符
    

```
if ((f = tabAt(tab, i)) == null) {
    advance = casTabAt(tab, i, null, new ForwardingNode<K,V>(nextTab));
}
```

> get/put 操作如果遇到 ForwardingNode 会自动跳转到 nextTable 继续查找或插入。

---

**总结：**

ConcurrentHashMap 写操作流程是通过“乐观尝试（CAS）+ 局部悲观锁（synchronized）+ 扩容协作”三重机制结合，实现了高并发场景下的线程安全。

---

如需，我可以继续为这部分配图（流程图、时序图）或导出为技术手册文档格式（如 PDF/Markdown/HTML）。是否需要？
  

## **链表↔红黑树转换**

  

如上所述，当某个桶中链表节点过多（默认超 8 个）时，会触发树化：判断条件是 binCount ≥ TREEIFY_THRESHOLD 且当前表容量 n ≥ MIN_TREEIFY_CAPACITY，满足则将该桶从链表转换为红黑树。转换过程中会对桶头加锁，创建一个 TreeBin 包装节点，然后依次将原链表节点以相同哈希顺序插入到红黑树中 。这样的转换是线程安全的，因为整个过程受锁保护，旧的链表结构在转换完成后一次性替换为树结构，不破坏查找正确性 。而当树节点数下降到 UNTREEIFY_THRESHOLD 以下时，会反向退化为链表。通过链表↔树的动态切换，ConcurrentHashMap 在保持线程安全的同时兼顾了冲突少时低开销和冲突多时高性能的需求。

  

## **扩容线程协作**

  

扩容（resize）阶段，ConcurrentHashMap 通过 transferIndex、nextTable、sizeCtl 等变量实现多线程协作。首先，一个线程在发现阈值条件满足时初始化 nextTable（容量为原表的两倍），并设置 transferIndex = n；然后其他线程通过 CAS 将 sizeCtl 置为负值并加一来表明“帮忙扩容线程数量” 。多个线程并发执行 transfer：每次循环中，通过原子地 CAS 将 transferIndex 减去一个批量大小（默认为 16），从而独占一段桶索引区间 。当某线程处理完自己的区段或 transferIndex 减到 0 时，它会在 sizeCtl 上将线程计数减一。最后一个退出线程将扫描位置重置到最高位、强制再扫一遍旧表（防止遗漏），然后将 table=nextTable，完成扩容 。整个过程中，读写线程如果遇到 ForwardingNode（hash=MOVED）会切换到新表继续查找，确保并发读写安全 。这种分段搬运的并发设计使得扩容操作可被多个线程协同完成，提高效率并避免长时间停顿。

  

## **JMM 与 JVM 内存映射**

  

Java 内存模型（JMM）与 JVM 实际运行时内存区域是不同的概念：JMM 描述的是线程与主内存之间的抽象关系和操作规则 ，而 JVM 的运行时内存则划分为主内存（Heap）、各线程的本地内存、栈等 。在 JMM 中，每个线程都有一块**工作内存**（Working Memory）用于缓存所需的共享变量，这在现实中对应 CPU 的缓存（L1/L2 Cache）、寄存器和写缓冲区 。使用 volatile、CAS、锁等同步原语时，JVM/CPU 会执行相应的内存屏障，把工作内存中的值与主内存同步，保证不同线程间的可见性。例如，volatile 读写操作就会相应地刷新或读取主内存，从而遵守 JMM “先行发生（happens-before）”规则 。在 ConcurrentHashMap 中，每个线程的本地栈帧保存局部变量和指令执行状态，当执行到对共享结构的操作时，CPU 的缓存和总线协议会确保与主内存中 table 等变量的一致性。概括来说，ConcurrentHashMap 依赖 JMM 保证的可见性和原子性，通过 volatile 和原子指令把工作内存与主内存协同一致。

  

## **与其他锁方案对比**

  

与传统的锁机制相比，ConcurrentHashMap (JDK8) 的并发策略具有更细的粒度。**synchronized** 和 **ReentrantLock** 等粗锁在高并发下往往会导致线程严重竞争；而 CHM 采用每个桶头的小锁（加上大量 CAS 乐观尝试），使得大多数操作是无锁（或只锁定单个链表头），从而获得更高的吞吐量 。与 **StampedLock** 相比，CHM 内部并未使用乐观读锁，而是直接利用数据结构自身的不可变性（如尾插链表保证遍历安全）和读写锁（在 TreeBin 内部）来兼顾安全与性能。可以说，JDK8 的 ConcurrentHashMap 将锁的作用范围极度局部化，结合 CAS 和有限的自旋，大大优于全表或全段锁在多核环境中的表现 。

  

## **常见并发误区**

- **get非阻塞但可能读到中间状态：** 虽然 get 不加锁，但在并发写时可能看到结构变化的中间态。例如在遍历链表时，如果另一线程刚好插入或删除节点，get 线程可能跳过新尾节点或暂时遍历到一个已被逻辑删除（但指针未改）的节点。但是由于 JDK8 采用尾插法和适当的同步，这并不会导致丢失节点或遍历环路，结果仍为某一时刻有效的快照 。
    
- **错误使用computeIfAbsent：** 在高并发时，使用 computeIfAbsent 等原子计算方法会引入额外锁（ReservationNode 机制），以保证原子性；如果计算函数耗时较长，可能阻塞其他线程。应避免在这些方法中进行复杂计算。
    
- **键分布热点：** 如果大量线程同时操作同一个或哈希值相同的键，由于桶级锁竞争，该键的访问会退化成串行，严重影响性能。应尽量避免多个线程访问同一热点节点，可通过在键中加入额外扰动或使用分布式缓存等手段分散压力。
    

  

## **实战建议**

- **预估容量**：在初始化时指定足够大的容量（power of 2）和合适负载因子，可避免运行时扩容，从而减少扩容竞争。JDK8 中构造函数中的“并发度”参数已被忽略，只需关注初始容量和负载因子。
    
- **热点 Key 优化**：若某些 Key 被频繁并发写入，可考虑用**分段哈希**或**ThreadLocal**缓存等策略，将热点拆分到多个 key 或多个 map，降低单一桶的竞争。
    
- **减少锁争用**：尽量使用局部变量和避免共享可变对象，避免在 CHM 的锁区（synchronized 块）中做耗时操作。利用其非阻塞读取特性，在只读场景多用 get 而非冗余 put 或同步计算。
    
- **按需使用**：对于多核场景，ConcurrentHashMap 通常是首选并发映射实现；但在写入极度密集且对一致性要求非常高的场景，也可考虑其他并发框架（如内存数据库、分布式锁等）。综上，合理评估访问模式和并发度，选择合适的数据结构和参数设置，是发挥 ConcurrentHashMap 最大性能的关键。
    

  

**参考资料：** 本文基于 JDK8 源码深入剖析，以及社区技术文章的分析 等，系统总结了 ConcurrentHashMap 的线程安全机制和实现原理。