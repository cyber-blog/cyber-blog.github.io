---
title: LoRA 微调指南
description: 简单介绍Lora微调的一些概念
slug: LLM Lora
date: 2025-12-08 00:00:00+0800
categories:
  - tech
tags:
  - Python
draft: false
---

## LoRA 原理

### Transformer 基础

**Transformer 是什么**

Transformer 是 2017 年 Google 提出的神经网络架构，论文名叫 "Attention is All You Need"。在此之前，处理文本序列主要用 RNN 或 LSTM，但这些模型有个致命缺陷：必须从左到右逐个字处理，处理第 100 个字时，第 1 个字的信息已经很弱了。更要命的是无法并行训练，训练效率极低，这也限制了模型无法做得很大。

Transformer 的核心创新是 **Self-Attention 机制**。简单说，就是让模型在处理任何一个词时，都能直接"看到"整句话的所有词，计算它们之间的关系。距离不再是问题，第 100 个词可以直接关注第 1 个词。而且所有位置可以同时计算，训练速度提升几十倍。

这个突破让模型可以做得很大。Transformer 可以轻松堆叠到几十层、几百层，参数量达到数百亿。GPT-4、Claude、Llama、Qwen 这些大语言模型都是基于 Transformer，在数万亿 token 的文本上预训练出来的。

**Transformer 整体架构**

以美团 LongCat-1.5B 为例（中文长文本模型）：

```
输入文本："我爱北京天安门"
    ↓
┌─────────────────────────┐
│  词向量化 (Embedding)    │  将每个字转换为向量
│  "我"  → [0.23, -0.45, 0.89, ...]  (2048维)
│  "爱"  → [0.67, 0.12, -0.34, ...]
│  "北京" → [...], "天安门" → [...]
└─────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  Transformer Block 1 (第1层)        │
│  ┌─────────────────────────────┐   │
│  │  Self-Attention             │   │  ← LoRA 主要应用
│  │  W_q, W_k, W_v, W_o (4个矩阵) │   │     这些矩阵
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  Feed-Forward Network       │   │  ← 需要时应用
│  │  W_up, W_down (2个矩阵)      │   │     LoRA
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  Transformer Block 2 (第2层)        │
│  ┌─────────────────────────────┐   │
│  │  Self-Attention (4个矩阵)    │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  FFN (2个矩阵)               │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
    ↓
    ... (继续堆叠，LongCat-1.5B 有24层)
    ↓
┌─────────────────────────────────────┐
│  Transformer Block 24 (第24层)      │
│  ┌─────────────────────────────┐   │
│  │  Self-Attention              │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │  FFN                         │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────┐
│  输出层 (LM Head)        │  根据任务输出结果
│  - 文本生成：下一个词      │
│  - 分类：类别概率         │
│  - 姓名拆分：JSON        │
└─────────────────────────┘
    ↓
输出结果
```

**关键点**：
- 每层有 Self-Attention（4个矩阵）+ FFN（2-3个矩阵，因模型而异）
- 不同模型的层数、维度、FFN结构都不同，LoRA 配置需查看模型的 `config.json`
- LoRA 不改原始矩阵，在旁边添加小的低秩矩阵



**Block 内部机制详解**

**1. 层次传递与参数分布**

信息在 Transformer 中从底层向顶层传递，每经过一层，理解就更深一层。浅层（前几层）关注词性、语法等局部特征，深层（后几层）理解完整的语义和逻辑。

每层的参数分布：
- **Self-Attention**：4 个权重矩阵（W_q, W_k, W_v, W_o），每个 [d_model × d_model]，参数量占整层约 **20%**。这是 **LoRA 最常应用的地方**
- **FFN**：2-3 个权重矩阵（W_up, W_down 或额外的 W_gate），FFN 维度通常是 d_model 的 4-5 倍（如 d_model=2048 时，FFN 维度约 8192-10240），参数量占整层约 **80%**。研究表明 FFN 存储了模型的大部分知识，领域适配时需要对 FFN 应用 LoRA

**2. Self-Attention 计算过程**

用"我爱北京天安门"这句话举例，看 Self-Attention 如何让"爱"这个字理解上下文：

```
输入句子："我 爱 北京 天安门"
         [x1 x2 x3  x4]  ← 每个字是一个向量

步骤1: 通过 W_q、W_k、W_v 生成三个表示
┌────────────────────────────────────┐
│ Q = X @ W_q   "我想查询什么信息"      │
│ K = X @ W_k   "我能提供什么信息"      │
│ V = X @ W_v   "我实际传递的内容"      │
└────────────────────────────────────┘

步骤2: 计算注意力分数
"爱" 这个字要理解上下文，它会：
- 用它的 Q（查询）去匹配所有字的 K（键）
- 得到分数：和 "我" 的相关度、和 "北京" 的相关度...

┌─────────────────────────────────────┐
│  "爱" 的注意力分布：                  │
│  我    → 0.3  (关注度30%)            │
│  爱    → 0.1  (自己10%)              │
│  北京  → 0.4  (重点关注40%)          │
│  天安门 → 0.2  (关注20%)             │
└─────────────────────────────────────┘

步骤3: 加权求和
用上面的分数，对所有字的 V（值）加权求和：
output = 0.3×V_我 + 0.1×V_爱 + 0.4×V_北京 + 0.2×V_天安门

步骤4: 通过 W_o 输出
final_output = output @ W_o
```

Self-Attention 的 4 个矩阵（W_q, W_k, W_v, W_o）都很大，每个都是 [d_model × d_model]。这些矩阵是 LoRA 主要应用的地方。

**FFN 工作原理**

FFN 与 Self-Attention 不同，它对每个词独立处理，不考虑上下文：

```
输入："爱" 这个字的向量 (512维)
   ↓
[W_up 升维]
   ↓
变成 2048维 向量  ← 扩展表达空间
   ↓
[激活函数 gelu]
   ↓
非线性变换  ← 增加模型能力
   ↓
[W_down 降维]
   ↓
回到 512维  ← 输出
```

这个过程像是"思考"：先扩展思路（升维），再聚焦结论（降维）。

**参数规模示例**（Qwen2.5-3B）

```
单个 Transformer Block 的参数分布：

Self-Attention 层：
├─ W_q: [3584 × 3584] = 12,845,056 个参数
├─ W_k: [3584 × 3584] = 12,845,056 个参数
├─ W_v: [3584 × 3584] = 12,845,056 个参数
└─ W_o: [3584 × 3584] = 12,845,056 个参数
   小计：51.4M 参数 (20%)

Feed-Forward Network：
├─ W_up:   [3584 × 18944] = 67,895,296 个参数
├─ W_gate: [3584 × 18944] = 67,895,296 个参数
└─ W_down: [18944 × 3584] = 67,895,296 个参数
   小计：203.7M 参数 (80%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
单层总计：255M 参数
32 层总计：8.16B 参数 (占整个模型 80% 以上)
```

**全量微调的困境**

传统微调需要更新所有这些参数：
- 8.16B 个参数需要存储梯度
- 优化器（如 Adam）需要额外存储两倍参数量的状态
- **总显存需求**：8B × (2字节模型 + 2字节梯度 + 8字节优化器) = 96GB+
- 单卡 24GB 显卡根本无法训练

LoRA 的目标就是解决这个问题：只训练极少量参数，就能达到接近全量微调的效果。

**微调是什么**

这些预训练模型已经学会了语言的基本规律（语法、常识、推理能力），但它们不了解你的具体任务。比如你要做姓名拆分，模型需要学习各语言的姓名结构；你要做医疗问答，模型需要学习专业术语。

微调就是调整模型内部的参数（本质上就是一堆数字），让它适配特定任务。Transformer 模型有几十亿个参数，传统微调要更新所有参数，需要巨大的显存和计算资源。LoRA 的创新在于：只调整一小部分参数（不到 1%），就能达到接近全量微调的效果。

### LoRA 的应用场景

#### LoRA 适合什么任务

LoRA 不是万能的，它的强项是"激活"预训练模型已有的能力，而不是注入全新知识。

**最适合的场景**

1. **格式化输出**

基座模型知道姓名的概念，但不会输出标准 JSON。通过 LoRA 微调，可以让它稳定输出结构化数据：

```
输入："请拆分姓名：张三"
输出：{"firstName": "张", "lastName": "三"}
```

其他格式化输出任务也同样适合：Markdown 表格、XML 文档、SQL 查询、YAML 配置等。这些任务的共同点是：模型理解内容，但需要学会按特定格式输出。LoRA 的小参数量足以完成这种"格式适配"，效果通常能达到 95% 以上。

2. **风格调整**

把通用对话模型变成客服语气、把正式文本改成口语风格、让技术文档更易懂。模型本身有这些能力，LoRA 只是调整输出倾向。

3. **指令遵循强化**

让模型更严格地按照指令执行，比如"只输出答案，不要解释"、"拒绝回答超出范围的问题"。

**效果有限的场景**

4. **领域适配**

让通用模型学习医疗、法律、金融等专业术语。如果基座模型预训练时见过这个领域（比如 Qwen 在大规模中文语料上训练，肯定见过医学文本），LoRA 可以激活这部分知识。但如果领域太窄（比如某个小公司的内部术语），LoRA 的参数量太少，学不进去太多新知识。

这种情况下，**选对基座模型**比微调更重要。比如做医疗任务，优先选在医疗语料上预训练过的华佗GPT、本草，而不是拿通用模型来 LoRA。

5. **多语言增强**

Qwen、Llama 这些模型预训练时主要是中英文，对小语种（阿拉伯语、泰语）支持一般。可以用该语言的数据做 LoRA，提升能力。但要注意：LoRA 参数量小，能提升的幅度有限，不如直接选多语言预训练更好的模型（如 mGPT）。

#### LoRA 的局限性

理解 LoRA 做不到什么，和理解它能做什么一样重要：

1. **不能注入大量新知识**

LoRA 是"激活器"，不是"知识注入器"。如果基座模型预训练时从没见过某个概念，LoRA 很难让它学会。比如"让模型学习我们公司 10 万条内部文档的内容"——LoRA 只有不到 1% 的参数，存不下这么多信息。

这种情况应该用 RAG（检索增强生成）：把文档存到向量数据库，让模型查询后再回答。或者做持续预训练，但那需要更多资源。

2. **不能改变模型底层能力**

让对话模型做图像理解、让中文模型精通日语——这超出了 LoRA 的范围。LoRA 参数通常只有基座模型的 0.1%-1%，相当于用 40MB 的参数去调整 4GB 的模型，能改变的范围有限。

你需要的是多模态模型（如 Qwen-VL）或多语言预训练模型，而不是微调。

3. **对数据质量敏感**

正因为参数少，LoRA 更依赖高质量数据。全量微调可以"用数据量弥补数据质量"，LoRA 不行。如果训练数据有噪音或标注错误，LoRA 的效果会明显下降。

4. **极端任务效果不如全量微调**

如果任务跟预训练差异很大（比如让对话模型去做代码补全），LoRA 效果会明显弱于全量微调。这时候应该考虑选择更合适的基座模型，或者直接全量微调。

**但这些局限性在实际应用中影响不大。** 对于格式化输出、指令遵循、风格调整这类任务，LoRA 的效果已经非常接近全量微调（论文中是 95%-98%），而成本只有 1/10。关键是选对任务场景。

#### LoRA vs 全量微调

什么时候用 LoRA，什么时候用全量微调？

| 场景 | LoRA | 全量微调 |
|------|------|----------|
| **格式输出、风格调整** | ✅ 推荐 | 过度 |
| **领域适配（词汇为主）** | ✅ 够用 | 效果更好但成本高 |
| **学习复杂新任务** | 可以试试 | ✅ 推荐 |
| **显存受限（单卡24GB）** | ✅ 唯一选择 | 不可行 |
| **需要维护多个版本** | ✅ 方便（多个adapter切换） | 麻烦（多个完整模型） |
| **追求极致性能** | 够用（约95%性能） | ✅ 最强 |

实际建议：**先用 LoRA 试试**。如果效果不够好，再考虑全量微调。大部分情况下 LoRA 已经够用了。

#### 训练方法：SFT vs DPO

LoRA 可以用在不同的训练方法中，最常见的是 SFT 和 DPO。

**SFT（Supervised Fine-Tuning，监督微调）**

给模型提供标准的输入-输出对，让它学会完成特定任务。数据格式很直观：

```json
{
  "instruction": "将以下文本翻译成英文：你好，世界",
  "output": "Hello, world"
}
```

这是最常用的微调方式，适合 99% 的场景：格式化输出、任务适配、领域迁移等。

**DPO（Direct Preference Optimization，直接偏好优化）**

给模型提供同一个问题的"好答案"和"坏答案"，让它学会区分质量：

```json
{
  "prompt": "解释什么是机器学习",
  "chosen": "机器学习是让计算机从数据中自动学习规律的技术。比如...",
  "rejected": "机器学习就是机器在学习东西。"
}
```

DPO 主要用在通用对话模型上，让回答更有帮助、更安全。垂直任务（如客服、翻译、数据提取）一般不需要 DPO，因为"正确答案"本身就很明确。

**对比总结：**
- **SFT**：需要正确答案，1000条就能见效，适合绝大多数任务
- **DPO**：需要成对的好坏对比，数据成本高 2-3 倍，主要用于风格优化

对于单卡 LoRA 微调，**优先使用 SFT**。DPO 通常在 SFT 之后作为第二阶段。

### LoRA 在 Transformer 中的应用

LoRA 不修改原始权重，而是添加低秩旁路。以 W_q 为例：

```
原始计算：Q = X @ W_q
LoRA 计算：Q = X @ W_q + X @ A @ B × (α/r)
                  ↑         ↑
               冻结不动   可训练低秩矩阵
```

**应用位置选择**

| 矩阵 | 作用 | 是否常用 | 配置名 |
|------|------|---------|--------|
| W_q | 控制注意力查询 | ✅ 核心 | `q_proj` |
| W_k | 提供匹配信息 | 可选 | `k_proj` |
| W_v | 决定输出内容 | ✅ 核心 | `v_proj` |
| W_o | 整合多头结果 | 可选 | `o_proj` |
| W_up/W_gate | 存储领域知识 | 领域任务 | `up_proj` |
| W_down | FFN 输出 | 领域任务 | `down_proj` |

**三种常见配置**

```python
# 最小配置：只改 Attention 的核心矩阵
target_modules = ["q_proj", "v_proj"]  # ~1% 参数

# 标准配置：完整 Attention
target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"]  # ~2% 参数

# 完整配置：Attention + FFN
target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                  "up_proj", "down_proj"]  # ~3% 参数
```

**参数量对比**（Qwen2.5-3B，r=64，标准配置）：

```
原始 W_q: [3584, 3584] = 12.8M 参数
LoRA A:   [3584, 64]   = 229K 参数
LoRA B:   [64, 3584]   = 229K 参数
总计: 458K（仅 3.6% 的原始参数量）

32 层 × 4 个矩阵 = 58.7M 可训练参数
压缩比：58.7M / 3B = 1.96%
```

### 数学原理

**核心思想：低秩分解**

全量微调时，权重更新 ΔW 是一个完整矩阵。LoRA 假设这个更新具有低秩结构，可以分解为两个小矩阵的乘积：

```
传统微调：W = W₀ + ΔW
          ΔW 是 [d, d] 矩阵，需要训练 d² 个参数

LoRA：W = W₀ + B @ A
      A 是 [r, d] 矩阵，B 是 [d, r] 矩阵
      只需训练 2×r×d 个参数，其中 r << d
```

**直观例子**（4×4 矩阵，r=2）：

```
全量微调需要训练：4×4 = 16 个参数
LoRA 需要训练：(2×4) + (4×2) = 16 个参数

但当矩阵更大时差异显著：
d=3584, r=64:
  全量：3584² = 12.8M 参数
  LoRA：2×64×3584 = 458K 参数（仅 3.6%）
```

**为什么低秩有效？**

研究表明预训练模型适配任务时，权重变化主要发生在低维子空间：
- 大模型参数高度冗余
- 任务适配不需要改变所有维度
- 低秩约束提供正则化，防止过拟合

**初始化策略**：
- A 用高斯分布随机初始化
- B 初始化为 0
- 确保训练开始时 ΔW = B @ A = 0（不影响原模型）

**缩放因子 α/r**：
- 归一化不同秩下的更新强度
- 通常设置 α = r，使更新强度保持一致



## 基座模型选择

### 主流模型对比

选择基座模型需要平衡性能、成本和部署需求。以下是几类常用的开源模型：

**Qwen3 系列**（阿里通义千问）

Qwen3-4B 是本项目使用的基座模型，也是目前中文能力最强的开源模型之一。指令遵循能力优秀，特别适合结构化输出任务。

- **Qwen3-4B**：36层，d_model=3584，FFN=18944（采用 GLU 结构）。在姓名拆分任务上，即使使用简单的 Prompt 也能达到较好效果（见 README.md 中的 Zero-shot 示例）
- 预训练数据更新至 2024年12月，包含更多多语言和结构化数据
- 指令遵循能力增强，LoRA 微调后在复杂格式输出上更稳定
- 单卡 24GB 可舒适训练，推理速度快

**Llama 系列**（Meta）

Llama 3/3.1 在英文和代码任务上表现优异，多语言能力也不错。社区支持最完善，各种优化工具最多。

- **Llama 3.1 8B**：32层，d_model=4096。与 Qwen2.5-7B 性能接近，英文更强
- **Llama 3.3 70B**：80层，d_model=8192。需要多卡或量化，但能力接近 GPT-4 早期版本

Llama 同样使用 GLU 结构（gate_proj, up_proj, down_proj），LoRA 配置时需要覆盖这三个矩阵。

**LongCat 系列**（美团）

美团自研的 LongCat 系列包含多个版本，适合不同场景：

*LongCat-8B-32K-Base*

- **8B 参数**的基座模型，支持 32K 上下文长度
- **Base 版本**：未经指令微调，适合作为 LoRA 微调的起点，可以针对特定任务进行深度定制
- **硬件友好**：单张 A100-80G 或 A100-40G 即可运行，单卡 24GB（4-bit 量化）可进行 LoRA 训练
- **发布时间**：2024年8月，相对较新的模型

*LongCat-Flash-Chat*

- **560B 总参数**的 MoE 架构智能体模型，在 ArenaHard-V2 基准测试中排名第二
- 推理速度快（H800 上 100 tokens/s），但 LoRA 微调需要多卡环境

对于单卡 LoRA 微调，LongCat-8B-32K-Base 是不错的选择，特别是需要长上下文支持的场景。

**领域专用模型**

如果你的任务属于特定领域，可以选择已经过领域预训练的模型：

- **医疗**：华佗GPT、本草（基于 Llama/Qwen 在医疗数据上继续预训练）
- **法律**：ChatLaw、智海（法律文书、判例数据预训练）
- **金融**：FinGPT、轩辕（金融报告、政策文档预训练）

领域模型的优势是已经学习了专业术语，LoRA 微调时收敛更快、需要的数据更少。

**选择建议**

1. **首选 Qwen 系列**：中文任务首选 Qwen3，生态完善，文档齐全
2. **英文优先选 Llama**：国际化产品或英文为主的任务，Llama 3.1 更合适
3. **长上下文选 LongCat**：需要处理长文档、长对话的场景，LongCat-8B-32K-Base 提供 32K 上下文支持
5. **看显存决定规模**：24GB 单卡建议 4B-8B，48GB 可用 14B，多卡或云端可上 70B
6. **先用小模型验证**：开发阶段用 4B-8B 模型快速迭代，验证 Prompt 和数据质量后再换大模型

### 模型获取与加载

**从 Hugging Face 下载**

```bash
# 安装依赖
pip install huggingface_hub

# 下载模型（会缓存到 ~/.cache/huggingface/）
python -c "
from transformers import AutoModelForCausalLM, AutoTokenizer
model = AutoModelForCausalLM.from_pretrained('Qwen/Qwen3-4B')
tokenizer = AutoTokenizer.from_pretrained('Qwen/Qwen3-4B')
"

# 或使用 huggingface-cli
huggingface-cli download Qwen/Qwen3-4B
```

**从 ModelScope 下载**（国内更快）

```bash
pip install modelscope

python -c "
from modelscope import snapshot_download
model_dir = snapshot_download('Qwen/Qwen3-4B')
print(f'模型已下载到: {model_dir}')
"
```

**指定本地路径**

如果已经下载好模型，训练时直接指定路径：

```python
from transformers import AutoModelForCausalLM

# 方式1：使用缓存路径
model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-4B",  # 会自动找缓存
    device_map="auto"
)

# 方式2：使用绝对路径
model = AutoModelForCausalLM.from_pretrained(
    "/path/to/Qwen3-4B",  # 本地目录
    device_map="auto"
)
```

模型目录结构：
```
Qwen3-4B/
├── config.json              # 模型配置（层数、维度等）
├── model.safetensors.index.json  # 参数文件索引
├── model-00001-of-00003.safetensors  # 参数分片1
├── model-00002-of-00003.safetensors  # 参数分片2
├── model-00003-of-00003.safetensors  # 参数分片3
├── tokenizer.json           # 分词器
└── tokenizer_config.json    # 分词器配置
```

**量化模型**（可选）

如果显存不够，可以用量化版本：

```python
# 4-bit 量化（需要 bitsandbytes）
model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-4B",
    load_in_4bit=True,          # 4-bit 量化
    device_map="auto"
)
# 4B 模型从 ~8GB 降到 ~2.5GB
```

量化会略微降低精度，但对 LoRA 微调影响不大。实测 4-bit 量化 + LoRA 微调后，效果与全精度微调几乎一致。


## 数据集准备

### 需要多少数据

LoRA 微调所需的数据量远小于全量微调，但"需要多少"取决于很多因素，很难给出精确数字。以下是基于实践经验的参考范围：

**快速参考表**

| 任务类型 | 最小可行 | 推荐范围 | 说明 |
|---------|---------|---------|------|
| **格式化输出** | 200-500 | 1000-3000 | JSON、表格、XML 等结构化输出 |
| **风格调整** | 500-1000 | 2000-5000 | 客服语气、正式/口语转换 |
| **指令遵循** | 500-1000 | 2000-4000 | 严格按指令执行、输出约束 |
| **多任务学习** | 3000-5000 | 10000-20000 | 同时训练多个相关任务 |
| **多语言增强** | 1000-2000 | 3000-6000 | 提升小语种能力（效果有限）|

**影响数据量需求的因素**

1. **基座模型能力**
   - 强模型（Qwen3-4B、Llama 8B）：数据量需求较少
   - 弱模型（1.5B 以下）：可能需要 2-3 倍数据量
   - 如果基座模型 zero-shot（不微调直接做任务）已经有 60% 准确率，可能 1000 条就够；如果 zero-shot 只有 10%，可能需要 10000 条

2. **任务与预训练的相似度**
   - 高度相似（如中文情感分析，模型训练时见过类似任务）：1000-3000 条
   - 中等相似（如特定领域分类）：3000-8000 条
   - 低相似度（小众语言、特殊格式）：8000+ 条

3. **数据质量**
   - 高质量、标注准确、覆盖全面：数据量需求减半
   - 质量一般、有噪音：需要 2-3 倍数据量来"压过"噪音

4. **期望效果**
   - Demo 级别（70-80% 准确率）：最小可行数据量
   - 生产可用（85-90%）：推荐范围的中位数
   - 接近完美（95%+）：推荐范围的上限，甚至更多

**实践建议：从小开始，逐步增加**

不要一开始就准备 10000 条数据。推荐流程：

1. **第一批：200-500 条**
   - 验证流程是否跑通
   - 观察模型是否有学习的迹象（loss 下降、输出格式对了）

2. **第二批：1000-2000 条**
   - 如果第一批效果不错，扩充到这个量级
   - 在验证集上评估，看是否达到可用标准

3. **第三批：按需补充**
   - 找出模型出错的 case，有针对性地补充数据
   - 每次增加 1000-2000 条，观察边际收益
   - 当增加数据后效果提升不明显（<1%），就可以停止了

**不建议用 LoRA 的任务**

以下任务更适合全量微调或直接用大模型：

- **复杂推理**：多步骤逻辑推理、数学证明、因果推理
- **代码生成**：从需求生成完整代码、算法实现
- **知识密集型**：需要记忆大量事实知识的任务

这些任务需要模型具备深层推理能力或大量知识储备，LoRA 的小参数量无法胜任。如果必须做，建议：
1. 选择推理能力强的大模型（如 70B+）作为基座
2. 考虑全量微调而非 LoRA
3. 或者用 RAG、Chain-of-Thought 等技术辅助

**数据质量 > 数量**

与其收集大量低质量数据，不如确保每条数据的准确性：

- **错误标注会误导模型**：一条错误数据可能需要 10 条正确数据来纠正
- **多样性更重要**：覆盖不同场景的 100 条数据，比 1000 条相似数据更有价值
- **困难样本加倍价值**：边界情况、罕见场景对模型泛化能力提升显著

**渐进式训练策略**

比起一次性用所有数据训练，分阶段训练往往效果更好：

1. **第一阶段**：用核心数据建立基础能力（如 3000 条覆盖主要场景）
2. **第二阶段**：加入困难样本强化边界处理（如 2000 条罕见情况）
3. **第三阶段**：全量数据进行最终优化

这种策略让模型先学会主流模式，再逐步处理复杂情况，避免被边界case干扰基础学习。

### 数据来源

根据任务特点和资源情况，可以从以下渠道获取训练数据：

**真实业务数据**

真实数据是首选。用户实际输入包含拼写错误、语序混乱、边界情况等模型需要学习的真实分布，训练出的模型泛化能力最强。

隐私合规要求：
- **脱敏处理**：姓名、手机号、身份证等敏感信息需要替换为假数据（保留格式）或泛化为占位符
- **法规遵守**：遵守 GDPR、个人信息保护法等数据保护法规
- **内部审批**：确保数据使用经过公司法务和安全团队审批

**公开数据集**

常用的高质量中英文数据集：

- **对话任务**：COIG、BelleCN、Alpaca、ShareGPT
- **情感分析**：IMDB（英文）、豆瓣电影评论（中文）
- **翻译**：WMT、OPUS
- **摘要**：CNN/DailyMail（英文）、LCSTS（中文新闻摘要）
- **代码**：CodeAlpaca、CodeContests

注意事项：
- 公开数据集往往与实际场景存在分布差异（如 IMDB 电影评论 vs 商品评论）
- 需要筛选、清洗和验证后使用
- 适合快速启动项目或补充特定类型的数据

**大模型生成数据**

使用 GPT-4、Claude、Qwen 等模型生成训练数据：

```python
prompt = """
生成 10 条客服对话，场景是用户咨询退货政策。
要求：
1. 用户提问多样化：直接询问、委婉表达、情绪化表达
2. 客服回答专业、礼貌、简洁
3. 覆盖不同退货场景：未拆封、已使用、超期等

格式：
{"user": "...", "assistant": "..."}
"""
```

质量控制流程：
1. 先生成 1000 条，随机抽样 100 条人工审核
2. 评估问题（回答冗长、场景覆盖不全、格式不一致等）
3. 调整 prompt 后重新生成
4. 重复迭代直到质量达标

模型选择：GPT-4 质量最高但成本高，开源模型（Qwen、Llama）成本低但需要更多人工审核。

**混合使用策略**

实际项目推荐的数据组合方式：

1. **快速启动**：用 GPT-4 生成 2000-3000 条数据，验证流程可行性
2. **评估短板**：用真实数据测试模型，找出失败的 case
3. **针对性补充**：对模型表现差的场景，人工标注 500-1000 条数据
4. **持续优化**：模型上线后收集用户反馈和困难样本，定期补充训练

典型数据配比：60% 生成数据（快速覆盖主流场景）+ 30% 真实数据（保证分布一致）+ 10% 人工标注（解决困难样本）

**人工标注与质量控制**

无论数据从何处获取，都需要人工审核和清洗。1 条错误数据需要 10 条正确数据纠正，标注错误率超过 10% 会让模型学偏。

质量控制要点：

1. **格式统一**：字段名一致、UTF-8 编码、JSON 合法
2. **过滤无效数据**：空值、输入过短（< 5 字符）、输出过长（> 1000 字符）、输入输出相同、包含"抱歉"/"无法回答"
3. **一致性检查**：相同输入不能有不同输出、标注标准统一
4. **去重**：删除完全重复或相似度 > 90% 的数据
5. **覆盖度**：场景全面（正常/边界/错误 case），输入表达多样（避免模板化）

质量评估方法：
- 人工抽查 100 条，错误率 < 5% 为合格
- 用 10% 数据训练 1-2 轮，在剩余 90% 上算 loss，异常高说明数据有问题

实施建议：
- 制定明确标注规范，附正反例
- 分批标注（先标 500 条试标），每 1000 条抽查一次
- 小规模（< 5000 条）团队内部标注，大规模用众包平台并控制质量

### 数据格式

**SFT 数据格式**

LoRA 微调通常使用 SFT 格式，根据任务类型选择合适的格式：

*格式1：Alpaca 格式（经典格式）*

```json
{
  "instruction": "将以下文本分类为正面或负面",
  "input": "这部电影太无聊了，浪费时间",
  "output": "负面"
}
```

适用场景：简单的输入-输出任务，instruction 描述任务，input 是具体内容。

*格式2：对话格式（推荐）*

```json
{
  "messages": [
    {"role": "system", "content": "你是电商客服，回复简洁专业，主动提供解决方案"},
    {"role": "user", "content": "订单还没发货，我要退款"},
    {"role": "assistant", "content": "理解您的着急。我帮您查询订单状态：您的订单预计今天发货，如果超过 24 小时未发货，可以一键退款。现在为您优先处理发货，好吗？"}
  ]
}
```

适用场景：需要特定回复风格的对话任务（如客服语气、专业术语）。大部分现代框架推荐用这种格式。

*格式3：多轮对话*

```json
{
  "messages": [
    {"role": "user", "content": "我的 Python 程序报错了"},
    {"role": "assistant", "content": "请把错误信息发给我看看"},
    {"role": "user", "content": "KeyError: 'name'"},
    {"role": "assistant", "content": "这是字典缺少 'name' 键。检查代码中访问字典的地方，使用 dict.get('name') 或先判断 'name' in dict。"}
  ]
}
```

适用场景：需要理解上下文的多轮对话（如技术支持、咨询问答）。

*格式4：结构化输出*

```json
{
  "instruction": "从文本中提取人名和地名",
  "input": "张三在北京工作，李四在上海生活",
  "output": {
    "persons": ["张三", "李四"],
    "locations": ["北京", "上海"]
  }
}
```

适用场景：需要输出 JSON 的任务，如信息抽取、结构化数据生成。

**DPO 数据格式**

DPO（Direct Preference Optimization）用于优化模型的回答风格，需要成对的"好回答"和"坏回答"。大部分垂直任务用 SFT 就够了，DPO 主要用于风格优化和安全对齐。

*格式1：企业专属话术*

```json
{
  "prompt": "你们的理财产品收益怎么样",
  "chosen": "我们的稳健型产品近一年业绩比较基准为 3.2%-4.5%，但理财非存款，产品有风险，过往业绩不代表未来表现。您的风险承受能力如何？我可以帮您匹配合适的产品。",
  "rejected": "收益挺高的，年化能到 4% 以上，很稳定。"
}
```

适用场景：金融、医疗等合规要求高的行业，需要模型学会特定的风险提示话术和表达规范。

*格式2：品牌语言风格*

```json
{
  "prompt": "这个手机壳好看吗",
  "chosen": "这款是我们的爆款哦～ins 风设计超级出片！已经有 2000+ 小伙伴入手啦，搭配浅色系手机绝绝子 💕",
  "rejected": "这款手机壳采用 TPU 材质，具有良好的防摔性能，设计简约大方。"
}
```

适用场景：电商客服、社交媒体运营等需要特定品牌调性的场景，普通模型的回复太正式。

*格式3：内部知识问答*

```json
{
  "prompt": "报销流程是什么",
  "chosen": "费用报销流程：1) 在 OA 系统提交报销单，附发票照片；2) 直属领导审批；3) 财务审核（3 个工作日）；4) 每月 15 日统一打款。单笔超过 5000 元需要部门总监审批。",
  "rejected": "一般需要填写报销单，然后找领导签字，再交给财务处理。"
}
```

适用场景：企业内部助手，需要回答公司特有的流程、规范，这些知识普通模型不具备。

*格式4：多轮对话风格一致性*

```json
{
  "prompt": [
    {"role": "user", "content": "我想咨询下贷款"},
    {"role": "assistant", "content": "好的，请问您是想了解个人消费贷还是经营贷呢？"},
    {"role": "user", "content": "消费贷，能贷多少"}
  ],
  "chosen": [{"role": "assistant", "content": "消费贷额度根据您的信用评估确定，一般在 1-30 万之间。需要您提供身份证、收入证明等材料。具体额度以审批结果为准，我可以帮您做个初步评估，请问您的月收入大概是？"}],
  "rejected": [{"role": "assistant", "content": "最多能贷 30 万。"}]
}
```

适用场景：多轮对话中保持专业、合规的回答风格，引导用户提供必要信息。

**注意事项**

- chosen 和 rejected 差异要明显，否则模型学不到东西
- rejected 应该是"不够好"而非"事实错误"，避免引入错误知识
- 数据构造方式：人工标注、强模型生成后人工筛选、强模型 vs 弱模型对比

### 数据平衡

分类任务需要注意类别平衡。如果 70% 数据是"正面"，10% 是"中性"，模型会倾向于预测"正面"，遇到"这个产品一般般"这种模糊输入时容易误判。

有三种处理方式：

1. **均匀采样**：把每个类别调整为相同数量（如都是 1000 条）。样本少的类别重复采样，样本多的随机抽取。适合各类别同等重要的场景。

2. **保持真实分布**：如果线上确实正面评论多、中性少，就按真实比例准备数据（如 50% 正面、30% 负面、20% 中性）。模型会适应实际分布。

3. **训练时加权**：数据保持不平衡，但训练时给少数类别更高权重。比如正面权重 1.0、中性权重 2.0，让模型更关注少数类别。适合某些边界情况特别重要的场景（如欺诈检测中的欺诈样本）。

验证集需要平衡：无论训练集用哪种策略，验证集应该覆盖所有类别，每个类别至少 50-100 条，这样才能准确评估模型能力。



## 硬件资源

### GPU 与云服务选择

**本地 GPU 选择**

如果要购买 GPU 用于 LoRA 微调：

**消费级显卡**（性价比高，适合个人学习）
- **RTX 4090**：24GB 显存，性能强劲，可训练 7B 模型（FP16）或 14B 模型（4-bit）
  - 价格：~$1600 USD
  - 适合：个人开发者、小团队
- **RTX 4080**：16GB 显存，可训练 3B-4B 模型（FP16）
  - 价格：~$1200 USD
  - 适合：预算有限但需要本地训练
- **RTX 3090**：24GB 显存，二手性价比高
  - 价格：二手 ~$800-1000 USD
  - 适合：预算紧张，可接受二手设备

**专业显卡**（企业级，显存更大）
- **A100 (40GB/80GB)**：最强训练卡，支持多卡并行
  - 价格：40GB ~$10000, 80GB ~$15000
  - 适合：企业、研究机构
- **A6000**：48GB 显存，比 A100 便宜
  - 价格：~$4500 USD
  - 适合：需要大显存但预算有限的企业

**云服务选择**

如果不想购买硬件，云服务按小时计费更灵活：

**国外云平台**

| 平台 | GPU 选项 | 价格 | 优势 | 劣势 |
|------|---------|------|------|------|
| **Google Colab** | T4 (16GB) 免费<br>A100 (40GB) Pro | 免费 / $10/月 | 免费额度<br>Jupyter 环境友好 | 免费版会断线<br>文件管理不便 |
| **AWS SageMaker** | ml.g5.xlarge (A10G, 24GB) | $1.41/小时 | 企业级稳定<br>与 AWS 服务集成 | 配置复杂<br>最低使用门槛 |
| **Google Cloud** | n1-highmem-8 + T4 | $0.95/小时 | 按秒计费<br>TPU 支持 | 新用户学习曲线陡 |
| **Vast.ai** | RTX 4090 | $0.20-0.40/小时 | 极低价格<br>GPU 选择多 | 个人出租，稳定性差<br>可能突然下线 |
| **Lambda Labs** | A100 (40GB) | $1.10/小时 | 专为 AI 优化<br>简单易用 | 库存紧张<br>需要抢机器 |

**国内云平台**

| 平台 | GPU 选项 | 价格 | 优势 | 劣势 |
|------|---------|------|------|------|
| **阿里云 PAI** | V100 (32GB) | ¥10-15/小时 | 国内访问快<br>与阿里云集成 | 价格较贵 |
| **腾讯云 TI** | T4 (16GB) | ¥5-8/小时 | 按量计费灵活 | 文档不够详细 |
| **AutoDL** | RTX 4090 (24GB) | ¥2-3/小时 | 价格极低<br>国内访问快 | 个人平台，稳定性一般 |
| **智星云** | RTX 3090 (24GB) | ¥1.5-2/小时 | 便宜<br>学生优惠 | 小平台，可能跑路 |

**成本估算**

本项目训练 Qwen3-4B 模型（10000 条数据，5 epochs）：
- **本地 RTX 4090**：训练约 2-3 小时，电费 ~¥2
- **Google Colab Pro**：A100 训练约 1 小时，包月 $10
- **AutoDL (RTX 4090)**：训练约 2 小时，成本 ~¥5
- **AWS (ml.g5.xlarge)**：训练约 2 小时，成本 ~$3

**选择建议**

1. **学习阶段**：Google Colab 免费版 + T4，足够跑通流程
2. **频繁训练**（每周 >10 次）：购买 RTX 4090，3 个月回本
3. **偶尔训练**（每月 <5 次）：AutoDL 或 Vast.ai 按需租用
4. **企业生产**：AWS/阿里云，稳定性和技术支持更好

**多卡并行**（可选）

如果有多张 GPU，可以加速训练：

```python
# DeepSpeed ZeRO-2 配置（简单高效）
deepspeed_config = {
    "train_batch_size": 32,
    "gradient_accumulation_steps": 4,
    "zero_optimization": {
        "stage": 2,  # 分割优化器状态
    }
}

# 启动训练（2 张 GPU）
deepspeed --num_gpus=2 train.py --deepspeed deepspeed_config.json
```

但对于 3B-7B 模型的 LoRA 微调，单卡通常足够，多卡收益不大。





## 项目初始化

在开始微调之前，建议按照标准化的结构组织项目文件。推荐使用 **uv** 进行现代化的 Python 项目管理和依赖管理。

### 标准项目结构

推荐采用标准的 UV 项目布局来组织代码，这种结构更利于包管理和测试。在运行`uv init`命令后即可创建如下项目结构：

```text
lora-project/
├── pyproject.toml          # ✅ 全局配置，替代 setup.py
├── uv.lock                 # ✅ 依赖版本锁定文件 (uv生成)
├── .venv/                  # ✅ 本地虚拟环境 (uv venv 创建)
├── src/
│   └── lora_finetune/      # ✅ 核心代码目录
│       ├── __init__.py
│       ├── train.py        # 训练逻辑
│       └── inference.py    # 推理逻辑
├── data/                   # ✅ 存放数据集 (手动创建)
│   ├── train.json
│   └── val.json
├── output/                 # ✅ 存放模型权重和日志 (自动生成)
├── tests/                  # ✅ 测试目录 (pytest 自动发现)
│   └── test_env.py
├── ruff.toml               # ✅ 代码风格配置
└── README.md               # ✅ 项目说明
```

### 依赖包安装

**1. 初始化项目**

```bash
# 1. 创建并初始化项目 (使用 lib 模式生成 src 结构)
uv init --lib --name lora_finetune lora-project
cd lora-project

# 2. 设定 Python 版本
uv python pin 3.10

# 3. 创建数据和测试目录
mkdir data
# tests/ 目录已由 init 自动生成
```

**2. 配置依赖 (pyproject.toml)**

直接在项目根目录编辑 `pyproject.toml` 文件，声明项目所需的所有依赖。这种方式比手动 `add` 更清晰，也便于版本管理。

```toml
[project]
name = "lora-finetune"
version = "0.1.0"
description = "LoRA fine-tuning project"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
    "torch",
    "torchvision",
    "transformers",
    "peft",
    "datasets",
    "accelerate",
    "bitsandbytes",
    "scipy",
    "scikit-learn",
    "tensorboard",
    "sentencepiece",
    "protobuf",
    "modelscope",
]

[tool.uv]
dev-dependencies = [
    "pytest",
    "ruff",
]

# 如需指定特定 CUDA 版本（如 12.1），请取消以下注释：
# [[tool.uv.index]]
# name = "pytorch-cu121"
# url = "https://download.pytorch.org/whl/cu121"
# explicit = true
#
# [tool.uv.sources]
# torch = { index = "pytorch-cu121" }
# torchvision = { index = "pytorch-cu121" }
```

**3. 一键安装依赖**

配置完成后，运行以下命令即可自动创建虚拟环境并安装所有依赖：

```bash
uv sync
```

**4. 验证环境**

我们在 `tests/` 目录下创建一个测试文件来验证环境：

```bash
cat <<EOF > tests/test_env.py
import torch
import transformers

def test_cuda_available():
    print(f"PyTorch: {torch.__version__}")
    if torch.cuda.is_available():
        print(f"Device: {torch.cuda.get_device_name(0)}")
    assert torch.cuda.is_available() == True, "CUDA not available"

def test_transformers_version():
    print(f"Transformers: {transformers.__version__}")
    assert transformers.__version__ is not None
EOF

# 运行测试
uv run pytest tests/test_env.py -s
```

> **为何使用 uv?**
> - **速度极快**：uv 的解析和安装速度远超 pip。
> - **环境隔离**：自动管理 `.venv`，避免环境污染。
> - **可复现性**：`uv.lock` 确保团队成员使用完全一致的依赖版本。



### 模型下载配置

了解模型的下载机制有助于解决网络问题和管理磁盘空间。

**1. 自动下载机制**

模型的自动下载和缓存管理实际上是由 **`huggingface_hub`** 这个库执行的（它是 `transformers` 的核心依赖）。
- 当你调用 `from_pretrained("Qwen/Qwen3-4B")` 时，`transformers` 会调用 `huggingface_hub` 检查本地缓存。
- 若未命中缓存，则从 Hugging Face Hub 下载并保存到默认路径：`~/.cache/huggingface/hub`。

**2. 配置魔搭社区（ModelScope）下载**

对于国内用户，直接从 Hugging Face 下载可能速度较慢或连接失败。推荐使用 **魔搭社区 (ModelScope)** 作为下载源。

**安装依赖**

```bash
pip install modelscope
```

**配置环境变量（可选）**

虽然 ModelScope 主要通过 Python SDK 使用，但你可以设置环境变量来修改其默认缓存路径：

```bash
export MODELSCOPE_CACHE=/path/to/your/cache  # 修改下载缓存路径
```

**使用方式**

在代码中，使用 `modelscope` 的 `snapshot_download`替代直接的 `from_pretrained` 下载：

```python
from modelscope import snapshot_download
from transformers import AutoModelForCausalLM, AutoTokenizer

# 1. 从魔搭下载模型（自动处理断点续传）
model_dir = snapshot_download('Qwen/Qwen3-4B')

# 2. 加载下载好的模型
tokenizer = AutoTokenizer.from_pretrained(model_dir, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(model_dir, device_map="auto", trust_remote_code=True)
```

> **提示**：也可以使用环境变量 `HF_ENDPOINT=https://hf-mirror.com` 来加速原生 Hugging Face 的下载，但这属于镜像站方案，与 ModelScope 是两套系统。


## LoRA 参数讲解

### target_modules

`target_modules` 指定在哪些权重矩阵上应用 LoRA。这是最重要的配置参数，直接影响效果和训练成本。

**查看模型的可用模块**

不同模型的模块名称不同，需要查看模型结构：

```python
from transformers import AutoModelForCausalLM

model = AutoModelForCausalLM.from_pretrained("Qwen/Qwen3-4B")

# 打印所有模块名称
for name, module in model.named_modules():
    if "linear" in name.lower() or "proj" in name.lower():
        print(name)

# 输出示例（Qwen 系列）：
# model.layers.0.self_attn.q_proj
# model.layers.0.self_attn.k_proj
# model.layers.0.self_attn.v_proj
# model.layers.0.self_attn.o_proj
# model.layers.0.mlp.gate_proj
# model.layers.0.mlp.up_proj
# model.layers.0.mlp.down_proj
```

**常用配置方案**

```python
from peft import LoraConfig

# 方案1：最小配置（快速实验）
config = LoraConfig(
    target_modules=["q_proj", "v_proj"],
    r=32,
    lora_alpha=32,
)
# 参数量：~0.5-1%，适合数据量少、任务简单的场景
# 优势：训练快，显存占用少
# 劣势：表达能力有限，复杂任务效果差

# 方案2：标准配置（推荐）
config = LoraConfig(
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    r=64,
    lora_alpha=64,
)
# 参数量：~1-2%，适合大部分任务
# 优势：性能与成本平衡，覆盖完整 Attention
# 劣势：对数据量很大或极复杂的任务可能不够

# 方案3：完整配置（大规模任务）
config = LoraConfig(
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    r=128,
    lora_alpha=128,
)
# 参数量：~3-5%，适合数据量大、任务复杂的场景
# 优势：表达能力强，覆盖 Attention + FFN
# 劣势：训练慢，显存占用大，容易过拟合

# 方案4：使用正则匹配（简化配置）
config = LoraConfig(
    target_modules="all-linear",  # 自动应用到所有线性层
    r=64,
    lora_alpha=64,
)
# PEFT 0.6+ 支持，会自动识别所有 Linear 层
# 包括 Attention + FFN 的所有投影矩阵
```

**配置选择示例**

对于结构化输出任务（JSON 提取、实体识别、格式转换等），基座模型通常已具备语言理解能力，主要需要学习输出格式和约束规则，标准配置即可：

```python
config = LoraConfig(
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    r=64,
    lora_alpha=64,
)
```

这种配置适合大部分任务：覆盖完整 Attention 层，表达能力充足，训练速度和效果平衡。如果数据量少于 5000 条或任务特别简单，可以降到 r=32 节省时间。

### rank (r)

`rank` (r) 控制 LoRA 矩阵的秩，是低秩分解中的维度。r 越大，表达能力越强，但参数量也越大。

**rank 的影响**

回顾 LoRA 的参数量计算：
```
原始矩阵 W: [d, d] = d² 个参数
LoRA 矩阵 A + B: [d, r] + [r, d] = 2×r×d 个参数

压缩比 = 2×r×d / d² = 2r/d

示例（d=3584）：
r=8:   2×8/3584  = 0.45%  (极小，可能欠拟合)
r=32:  2×32/3584 = 1.79%  (较小，简单任务够用)
r=64:  2×64/3584 = 3.57%  (标准，大部分任务推荐)
r=128: 2×128/3584 = 7.14% (较大，复杂任务或数据量大)
r=256: 2×256/3584 = 14.3% (很大)
```

**选择建议**

| 任务类型 | 数据量 | 推荐 rank | 说明 |
|---------|--------|----------|------|
| 格式转换、风格调整 | <5000 | 16-32 | 任务简单，低秩足够 |
| 分类、NER、结构化输出 | 5000-20000 | 32-64 | 标准任务，平衡配置 |
| 复杂结构化输出 | 20000+ | 64-128 | 输出格式多变，模式复杂 |
| 多任务学习 | 50000+ | 128-256 | 同时学习多个任务 |

**rank 过大过小的影响**

- **rank 过小**（r=8, r=16）：参数量不足，模型表达能力受限，容易欠拟合（训练集和验证集 loss 都偏高）
- **rank 过大**（r=256）：参数量过多，模型记住训练集细节，容易过拟合（训练集 loss 很低但验证集 loss 高）
- **合适的 rank**（r=32-128）：在表达能力和泛化能力之间取得平衡

**动态调整策略**

如果不确定用多大的 rank，可以从小到大实验：

1. 先用 r=32 训练 2-3 epochs，观察 loss 曲线
2. 如果 loss 下降后趋于平稳，但验证集效果不理想 → 增大 rank
3. 如果 loss 持续下降但验证集不提升（过拟合）→ 减小 rank 或增加数据
4. 如果 loss 和验证集同步提升 → 当前 rank 合适

### lora_alpha 和 dropout

**lora_alpha：缩放因子**

`lora_alpha` 控制 LoRA 更新的强度，实际更新权重为：

```
ΔW = (lora_alpha / r) × B @ A
```

**常用配置**

```python
# 配置1：alpha = r（最常用）
LoraConfig(r=64, lora_alpha=64)
# 缩放系数 = 64/64 = 1.0
# 这是默认推荐，LoRA 论文的标准配置

# 配置2：alpha = 2×r（更强更新）
LoraConfig(r=64, lora_alpha=128)
# 缩放系数 = 128/64 = 2.0
# 适合数据量大、需要快速收敛的场景

# 配置3：alpha = r/2（更弱更新）
LoraConfig(r=64, lora_alpha=32)
# 缩放系数 = 32/64 = 0.5
# 适合担心过拟合、希望保留预训练知识的场景
```

**为什么要用 alpha/r 缩放？**

如果不缩放，改变 r 会改变更新强度，导致无法公平对比不同 rank 的效果。使用 alpha/r 归一化后：
- r=32, alpha=32 → 缩放系数 1.0
- r=64, alpha=64 → 缩放系数 1.0
- r=128, alpha=128 → 缩放系数 1.0

这样改变 rank 只影响表达能力，不影响更新强度。

**调整 alpha 的时机**

大部分情况 `alpha = r` 即可，但如果遇到：
- **训练不稳定**（loss 震荡）→ 减小 alpha，如 `alpha = r/2`
- **收敛太慢**（10 epochs 还在下降）→ 增大 alpha，如 `alpha = 2×r`
- **过拟合严重**（训练集完美但验证集差）→ 减小 alpha + 增加 dropout

**lora_dropout：防止过拟合**

`lora_dropout` 在 LoRA 层应用 dropout，随机丢弃一部分激活值，防止过拟合。

```python
LoraConfig(
    r=64,
    lora_alpha=64,
    lora_dropout=0.1,  # 10% dropout
)
```

**dropout 选择**

| 数据量 | 模型规模 | 推荐 dropout | 说明 |
|--------|---------|-------------|------|
| <5000 | 任意 | 0.05-0.1 | 数据少，容易过拟合 |
| 5000-20000 | <7B | 0.05 | 标准配置 |
| 5000-20000 | 7B-14B | 0.1 | 大模型容易过拟合 |
| >20000 | <7B | 0 | 数据足够，不需要 dropout |
| >20000 | 7B+ | 0.05 | 可选，看训练曲线决定 |

### bias

`bias` 控制是否训练偏置项，有三种选择：

```python
LoraConfig(
    bias="none",      # 不训练 bias（默认）
    bias="all",       # 训练所有 bias
    bias="lora_only"  # 只训练 LoRA 模块的 bias
)
```

**选择建议**

- **bias="none"**（推荐）：大部分情况下，LoRA 只调整权重矩阵就够了，不需要训练 bias。这是 LoRA 论文的默认配置。
- **bias="lora_only"**：如果模型在验证集上表现不稳定，可以尝试训练 LoRA 层的 bias，增加一些表达能力。
- **bias="all"**：训练所有 bias，参数量会增加，但对效果提升有限，通常不推荐。

### modules_to_save

`modules_to_save` 指定哪些模块要全量更新（不用 LoRA），而不是低秩分解。

```python
LoraConfig(
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    modules_to_save=["embed_tokens", "lm_head"]
)
```

**使用场景**

1. **词表扩展**：如果你添加了新的 token（如 `<tool_call>`），需要全量更新 `embed_tokens` 和 `lm_head`，否则新 token 的 embedding 不会被训练。

2. **分类任务**：如果是序列分类（情感分析、文本分类），需要全量更新分类头：
   ```python
   LoraConfig(
       task_type="SEQ_CLS",
       modules_to_save=["classifier", "score"]
   )
   ```

3. **多模态任务**：如果模型有视觉编码器或其他模态的投影层，可能需要全量更新这些模块。

**注意**：`modules_to_save` 会增加可训练参数量和显存占用。只在必要时使用。

### 完整配置示例

**标准配置**

```python
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM

# 加载基座模型
model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-4B",
    torch_dtype=torch.bfloat16,
    device_map="auto"
)

# LoRA 配置
lora_config = LoraConfig(
    task_type="CAUSAL_LM",                    # 任务类型
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    r=64,                                      # rank
    lora_alpha=64,                             # 缩放因子
    lora_dropout=0.05,                         # dropout
    bias="none",                               # 不训练 bias
)

# 应用 LoRA
model = get_peft_model(model, lora_config)

# 查看可训练参数
model.print_trainable_parameters()
# 输出：trainable params: 58,720,256 || all params: 3,958,720,256 || trainable%: 1.48%
```

**量化训练配置**（显存受限）

```python
from transformers import BitsAndBytesConfig

# 4-bit 量化配置
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",              # 4-bit NormalFloat
    bnb_4bit_compute_dtype=torch.bfloat16,  # 计算时用 bf16
    bnb_4bit_use_double_quant=True,         # 双重量化，进一步压缩
)

# 加载量化模型
model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-4B",
    quantization_config=bnb_config,
    device_map="auto"
)

# LoRA 配置（与上面相同）
lora_config = LoraConfig(
    task_type="CAUSAL_LM",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    r=64,
    lora_alpha=64,
    lora_dropout=0.05,
)

model = get_peft_model(model, lora_config)
# 显存需求从 ~10GB 降到 ~6GB
```

**复杂任务配置**（数据量大、任务复杂）

```python
lora_config = LoraConfig(
    task_type="CAUSAL_LM",
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",  # Attention
        "gate_proj", "up_proj", "down_proj"       # FFN
    ],
    r=128,                     # 更大的 rank
    lora_alpha=128,
    lora_dropout=0.1,          # 防止过拟合
)

# 适合场景：
# 1. 数据量大（>50000 条），需要更强的表达能力
# 2. 多任务学习，同时训练多个相关任务
# 3. 复杂的结构化输出，输出格式多变
```

**多卡训练配置**

```python
# 单机多卡（2 张 GPU）
lora_config = LoraConfig(
    task_type="CAUSAL_LM",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    r=64,
    lora_alpha=64,
    lora_dropout=0.05,
)

# 模型会自动分布到多卡
model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-4B",
    torch_dtype=torch.bfloat16,
    device_map="auto"  # 自动分配到多个 GPU
)

model = get_peft_model(model, lora_config)

# 训练参数需要调整
training_args = TrainingArguments(
    per_device_train_batch_size=4,    # 每张卡的 batch size
    gradient_accumulation_steps=2,    # 等效 batch_size = 4 × 2 × 2卡 = 16
    ddp_find_unused_parameters=False, # 加速 DDP
    ...
)
```

**推理时加载 LoRA 权重**

训练完成后，LoRA 权重保存在独立文件中（通常几十到几百 MB），推理时需要合并：

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

# 1. 加载基座模型
base_model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3-4B",
    torch_dtype=torch.bfloat16,
    device_map="auto"
)

# 2. 加载 LoRA 权重
model = PeftModel.from_pretrained(
    base_model,
    "path/to/lora_weights",  # 训练保存的目录
)

# 3. 推理
tokenizer = AutoTokenizer.from_pretrained("Qwen/Qwen3-4B")
inputs = tokenizer("你的提示词", return_tensors="pt").to(model.device)
outputs = model.generate(**inputs, max_length=100)
print(tokenizer.decode(outputs[0]))

# 可选：合并权重（加速推理）
model = model.merge_and_unload()
# 合并后成为普通模型，不再需要 PEFT 库
# 可以保存为标准格式：
model.save_pretrained("merged_model")
```

**配置对比总结**

| 场景 | target_modules | r | alpha | dropout | 显存 | 训练时间 |
|------|---------------|---|-------|---------|------|---------|
| 快速实验 | q,v | 32 | 32 | 0.05 | 8GB | 1.5h |
| 标准配置 | q,k,v,o | 64 | 64 | 0.05 | 10GB | 2.0h |
| 复杂任务 | q,k,v,o,gate,up,down | 128 | 128 | 0.1 | 14GB | 3.5h |
| 量化训练 | q,k,v,o | 64 | 64 | 0.05 | 6GB | 2.5h |

*时间基于 Qwen3-4B，10000 条数据，5 epochs，RTX 4090*

### 显存需求估算

LoRA 参数选择直接影响显存需求。训练时的显存占用包括：

```
总显存 = 模型权重 + LoRA 参数 + 优化器状态 + 梯度 + 激活值
```

**示例1：Qwen3-4B（标准配置 r=64）**

```
1. 模型权重：4B × 2 字节 (FP16) = 8 GB
2. LoRA 参数：72M × 2 字节 = 144 MB  (r=64, 36层)
3. 优化器状态 (AdamW)：72M × 8 字节 = 576 MB
4. 梯度：72M × 2 字节 = 144 MB
5. 激活值 (batch=4, seq=512)：约 1.03 GB

总计：8 + 0.14 + 0.58 + 0.14 + 1.03 ≈ 9.9 GB
```

**示例2：LongCat-8B-32K-Base（标准配置 r=64）**

```
1. 模型权重：8B × 2 字节 (FP16) = 16 GB
2. LoRA 参数：约 140M × 2 字节 = 280 MB
3. 优化器状态 (AdamW)：140M × 8 字节 = 1120 MB
4. 梯度：140M × 2 字节 = 280 MB
5. 激活值 (batch=4, seq=512)：约 1.5 GB

总计：16 + 0.28 + 1.12 + 0.28 + 1.5 ≈ 19.2 GB
```

激活值是显存大头，与 batch size 成正比。如果显存不足，减小 batch_size 配合梯度累积是最有效的方法。

**不同配置的显存需求**

| 模型 | 精度 | LoRA配置 | Batch Size | 梯度累积 | 显存需求 |
|------|------|---------|-----------|---------|---------|
| Qwen3-4B | FP16 | r=64 | 4 | 1 | ~10GB |
| Qwen3-4B | FP16 | r=64 | 1 | 4 | ~8GB |
| Qwen3-4B | 4-bit | r=64 | 4 | 1 | ~6GB |
| LongCat-8B | FP16 | r=64 | 4 | 1 | ~20GB |
| LongCat-8B | 4-bit | r=64 | 4 | 1 | ~12GB |

### 训练效果诊断与参数调优

LoRA 参数配置完成后，训练过程中最需要关注的是训练效果。本节介绍如何诊断训练问题并针对性地调整参数。

#### 过拟合识别与防治

**什么是过拟合**

过拟合指模型过度学习了训练数据的细节和噪声，而没有学到真正的规律。本质是**模型容量**与**数据量**不匹配导致的。

**核心原理（简要）**

LoRA 通过低秩分解控制可训练参数：`可训练参数 = 2 × r × d × L`（r 是 rank，d 是维度，L 是层数）

模型容量与数据量的关系：
- 数据量 >> 参数量：模型可以充分学习，泛化良好
- 数据量 ≈ 参数量：临界状态，容易过拟合
- 数据量 << 参数量：严重过拟合，模型记住训练集

经验规则：**数据量应至少是可训练参数数的 10-100 倍**

LoRA 中的容量控制：
- rank 太小 → 容量不足 → 欠拟合（训练/验证 loss 都高）
- rank 适中 → 容量平衡 → 泛化最优
- rank 太大 → 容量过剩 → 过拟合（训练 loss 低，验证 loss 高）

**常见过拟合原因**

1. **模型容量过大**：rank 太大（如 r=256），而训练数据 <10000 条
2. **训练时间过长**：epochs 过多，后期开始拟合噪声
3. **数据量不足**：样本太少，无法充分约束高维参数空间
4. **正则化不足**：dropout=0 或 weight_decay=0

**如何判断过拟合**

过拟合最明显的特征是：训练集表现好，验证集表现差。具体判断方法：

**1. 观察 Loss 曲线（最可靠）**

训练集 loss 持续下降，但验证集 loss 停止下降甚至回升：

```
Epoch 1: train_loss=0.85, eval_loss=0.92  ← 正常，两者都在下降
Epoch 2: train_loss=0.62, eval_loss=0.71  ← 正常
Epoch 3: train_loss=0.45, eval_loss=0.58  ← 正常，最佳点
Epoch 4: train_loss=0.32, eval_loss=0.54  ← 开始过拟合，train 降但 eval 几乎不降
Epoch 5: train_loss=0.21, eval_loss=0.56  ← 过拟合严重，eval 反而升高
```

**判断标准**：
- **健康状态**：train_loss 和 eval_loss 差距 <0.15，且都在下降
- **轻度过拟合**：差距 0.15-0.3，eval_loss 停止下降
- **严重过拟合**：差距 >0.3，eval_loss 回升

Epoch 3 是最佳模型，继续训练反而变差。应该用早停（Early Stopping）在 Epoch 3 停下来。

**2. 比较训练/验证指标**

如果你的任务有明确的指标（准确率、F1、BLEU 等）：

```
训练集准确率：98%  ← 很高
验证集准确率：85%  ← 明显偏低
差距：13%  ← 过拟合
```

**判断标准**：
- 差距 <5%：正常，模型泛化良好
- 差距 5-10%：轻度过拟合，可以接受
- 差距 >10%：严重过拟合，需要调整

**3. 实际测试（最直观）**

在实际应用中测试模型的泛化能力：

| 测试类型 | 健康模型 | 过拟合模型 |
|---------|---------|----------|
| 训练集原句 | ✓ 正确 | ✓ 正确 |
| 同义改写 | ✓ 正确 | ✗ 错误 |
| 相似场景 | ✓ 正确 | ✗ 错误 |
| 噪声输入（拼写错误） | ✓ 鲁棒 | ✗ 脆弱 |

**示例**：
- 训练句："这个产品质量很好" → 模型输出"好评"
- 改写："产品质量不错" → 健康模型输出"好评"，过拟合模型可能输出错误
- 拼写："这个产品至量很好"（错别字）→ 过拟合模型容易失败

如果模型只对训练集原句有效，对改写、相似输入失效，说明过拟合了。

**数据量与 Rank 匹配指南**

根据数据量选择合适的 rank，避免过拟合：

| 数据量 | 推荐 rank | 备注 |
|--------|----------|------|
| <1000 条 | r=8-16 | 极小数据，优先数据增强 |
| 1000-5000 条 | r=16-32 | 小规模任务 |
| 5000-20000 条 | r=32-64 | 标准配置 |
| 20000-50000 条 | r=64-128 | 中大规模任务 |
| >50000 条 | r=128-256 | 复杂任务可用高 rank |

**防止过拟合的方法**

**1. 早停（Early Stopping）**

最简单有效的方法，监控验证集 loss，不再下降时停止训练：

```python
from transformers import TrainingArguments, EarlyStoppingCallback

training_args = TrainingArguments(
    evaluation_strategy="epoch",           # 每个 epoch 验证一次
    save_strategy="epoch",                 # 每个 epoch 保存一次
    load_best_model_at_end=True,          # 训练结束加载最佳模型
    metric_for_best_model="eval_loss",    # 根据验证 loss 选择最佳模型
    greater_is_better=False,              # loss 越小越好
)

# 早停回调：验证 loss 连续 3 个 epoch 不下降就停止
trainer = Trainer(
    model=model,
    args=training_args,
    callbacks=[EarlyStoppingCallback(early_stopping_patience=3)]
)
```

**2. 增加正则化**

- **提高 dropout**：从 0.05 增加到 0.1 或 0.15
- **减小 learning rate**：从 2e-4 降到 1e-4，让模型更保守地更新
- **添加 weight decay**：
  ```python
  TrainingArguments(
      weight_decay=0.01,  # L2 正则化，防止权重过大
  )
  ```

**3. 调整模型容量**

- **减小 rank**：从 r=128 降到 r=64 或 r=32，减少参数量
- **减少 target_modules**：只更新 q_proj 和 v_proj，而不是所有 Attention 层

**4. 增加数据量和多样性**

- **数据增强**：同义词替换、回译、改写
- **增加训练数据**：如果可能，收集更多真实数据
- **数据清洗**：去除重复样本，提高数据质量

**5. 使用更大的验证集**

验证集太小（<100 条）会导致 eval_loss 不稳定。建议验证集至少占总数据的 10-20%。

**过拟合应对流程**

当观察到过拟合时，按以下顺序尝试：

1. **启用早停**：最简单，立即见效
2. **增加 dropout**：0.05 → 0.1
3. **减小 rank**：r=128 → r=64
4. **减少 epochs**：10 → 5
5. **增加数据量**：如果前面方法都不够，说明数据太少

**欠拟合 vs 过拟合**

| 现象 | 欠拟合 | 正常 | 过拟合 |
|------|--------|------|--------|
| 训练 loss | 高（>0.5） | 中（0.2-0.5） | 低（<0.2） |
| 验证 loss | 高（>0.6） | 中（0.3-0.6） | 高（>0.5） |
| loss 差距 | 小（<0.1） | 小（0.1-0.2） | 大（>0.3） |
| 解决方案 | 增大 rank<br>增加 epochs<br>提高 LR | 继续训练 | 减小 rank<br>早停<br>增加 dropout |
