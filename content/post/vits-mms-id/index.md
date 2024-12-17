---
title: 基于 MMS 模型的印尼语微调
description: 初次微调模型排坑纪实
slug: finetune-vits-mms-id
date: 2024-07-12
image: cover.png
categories:
  - tech
tags:
  - Python
  - AIGC
draft: false
---
VITS 是一种用于英语文本转语音 （TTS） 的轻量级、低延迟模型。
大规模多语言语音 （MMS） 是 VITS 的多语言 TTS 扩展，支持 1100 多种语言。

两者都使用相同的底层 VITS 架构，由一个鉴别器和一个用于基于 GAN 的训练的生成器组成。它们的标记器不同：VITS 标记器将英语输入文本转换为音素，而 MMS 标记器将输入文本转换为基于字符的标记。

如果要使用宽松的英语 TTS 模型，则应微调基于 VITS 的 checkpoint，并针对所有其他情况微调基于 MMS 的检查点。
针对印尼语的训练选择 [mms-tts-ind-train](https://huggingface.co/fadhilamri/mms-tts-ind-train)checkpoint

结合正确的数据和以下训练方法，您可以在 20 分钟内获得每个 VITS/MMS 检查点的出色微调版本，只需 80 到 150 个样本。

微调 VITS 或 MMS 需要按连续顺序完成多个阶段：
1. [Install requirements](https://github.com/ylacombe/finetune-hf-vits?tab=readme-ov-file#1-requirements)  
2. [Choose or create the initial model](https://github.com/ylacombe/finetune-hf-vits?tab=readme-ov-file#2-model-selection)  
3. [Finetune the model](https://github.com/ylacombe/finetune-hf-vits?tab=readme-ov-file#3-finetuning) 
4. [Optional - how to use the finetuned model](https://github.com/ylacombe/finetune-hf-vits?tab=readme-ov-file#4-inference)

#### 安装 requirements
0. 克隆仓库并 install，确保`python >= 3.10`
```python
git clone git@github.com:ylacombe/finetune-hf-vits.git
cd finetune-hf-vits
pip install -r requirements.txt
```
1. 链接您的 Hugging Face 帐户，以便您可以在 Hub 上拉取/推送模型仓库。这将使您能够在 Hub 上保存微调的权重，以便您可以与社区共享它们并轻松重复使用它们。运行以下命令：
```sh
git config --global credential.helper store
huggingface-cli login
```
2. 然后输入 https://huggingface.co/settings/tokens 的身份验证令牌。如果还没有令牌，请创建一个新令牌。您应确保此令牌具有“写入”权限。

3. 使用 Cython 构建`monotonic alignment search function`。这是绝对必要的，因为 Python 原生版本非常慢。
```sh
# Cython-version Monotonoic Alignment Search
cd monotonic_align
mkdir monotonic_align
python setup.py build_ext --inplace
cd ..
```
4. （可选）如果您使用的是原始 VITS 检查点，而不是 MMS 检查点，请安装`phonemizer`。
	按照[此处](https://bootphon.github.io/phonemizer/install.html)指示的步骤操作。
	例如，如果你在 Debian/Unbuntu 上：
```sh
# Install dependencies
sudo apt-get install festival espeak-ng mbrola
# Install phonemizer
pip install phonemizer
```
	更多细节
	某些语言要求在将文本提供给 `VitsTokenizer` 之前使用 `uroman`，因为目前分词器本身不支持执行预处理。
	为此，您需要将 uroman 仓库克隆到本地计算机，并将 bash 变量 UROMAN 设置为本地路径：

```shell
git clone https://github.com/isi-nlp/uroman.git
cd uroman
export UROMAN=$(pwd)
```

	剩下的就是由训练脚本来处理了。


#### 选择模型

如果需要的 `checkpoint` 已经存在。

目前一些`checkpoint`已经可用，参照如下列表可以在 Hugging Face 搜索
可以列表
- English
    - `ylacombe/vits-ljs-with-discriminator` (确保 [phonemizer](https://bootphon.github.io/phonemizer/install.html)已安装) - 非常适合单一声音微调
    - `ylacombe/vits-vctk-with-discriminator` (确保 [phonemizer](https://bootphon.github.io/phonemizer/install.html)已安装) - 适用于多声音英语微调。
    - `ylacombe/mms-tts-eng-train` - 如果您想避免使用 `phonemizer` 包。
- Spanish - `ylacombe/mms-tts-spa-train` 西班牙语
- Korean - `ylacombe/mms-tts-kor-train` 韩语
- Marathi - `ylacombe/mms-tts-mar-train` 马拉地语
- Tamil - `ylacombe/mms-tts-tam-train` 泰米尔语
- Gujarati - `ylacombe/mms-tts-guj-train` 古吉拉特语
在这种情况下，您找到了正确的检查点，记下存储库名称并直接传递到下一步🤗。
在这里我选择了 `fadhilamri/mms-tts-ind-train`🥳。

如果需要的需要微调的语言 `checkpoint` 不存在，请参考[这里](https://huggingface.co/dhavalgala/mms-tts-ind-train)创建对应语言的`checkpoint`。

#### 微调

使用 json 配置文件可以运行微调脚本，两种方法都使用命令行。请注意，您只需要一个 GPU 即可微调 VITS/MMS，因为模型非常轻巧（83M 参数）,根据数据集的大小对显存的需求有较大变化，我的数据集大小是`602MB`、需要 21GB 显存左右。

>Note
>使用配置文件是使用微调脚本的首选方式，因为它包含要考虑的最重要的参数。有关参数的完整列表，请运行 `python run_vits_finetuning.py --help`。请注意，训练脚本不会忽略某些参数。

[training_config_examples](https://github.com/ylacombe/finetune-hf-vits/blob/main/training_config_examples)文件夹包含配置文件的示例。一旦对您的配置文件感到满意，您就可以微调模型。

要考虑的重要参数：
- 与工件相关的所有内容：`project_name` 和输出目录 （`hub_model_id`， `output_dir`），用于跟踪模型。
- 需要微调的模型：`model_name_or_path`。
    - 这里，填写需要进行微调的模型（`checkpoint`）。
    - 例如，如果选择已存在的检查点：`ylacombe/vits-ljs-with-discriminator`，或者转换了自己的检查点：`<repo-id-you-want>` 或 `<local-folder>`。
- 数据集使用的 `dataset_name` 及其详细信息：`dataset_config_name`、列名等。
    - 如果有多个声音，而您只想保留一个声音，请注意 `speaker_id_column_name`、`override_speaker_embeddings` 和 `filter_on_speaker_id`。后者允许只保留一个声音，但您也可以使用多个声音进行训练。
    - 例如，[`finetune_english.json`](https://github.com/ylacombe/finetune-hf-vits/blob/main/training_config_examples/finetune_english.json) 中默认使用的数据集是 British Isles accents 数据集的子集，使用 `welsh_female` 配置的单个威尔士女声，由 `speaker_id=5223` 标识。
    - 如何打包本地数据到上传到 HuggingFace 的 Datasets 请参考我写的上一篇[博客](https://cyber-blog.github.io/p/dataset-upload2hugginface/)
- 超级重要的 `hyperparameters`‼
    - `learning_rate`
    - `batch_size`
    - 各种损失权重：`weight_duration`、`weight_kl`、`weight_mel`、`weight_disc`、`weight_gen` 、`weight_fmaps`

可以参考我进行微调的配置文件
```json
{  
    "project_name": "vits_finetuned_ind_female", 
    "push_to_hub": true,
    "hub_model_id": "dhavalgala/mms-tts-ind-train",  
    "overwrite_output_dir": true,  
    "output_dir": "./tmp/vits_finetuned_ind_female",
    "dataset_name": "Majiang213/ind_famal",  
    "dataset_config_name": "data",  
    "audio_column_name": "audio",  
    "text_column_name": "text", 
    
    "train_split_name": "train",  
    "eval_split_name": "train",  
    "speaker_id_column_name": "speaker_id",  
    "override_speaker_embeddings": true,  
    "filter_on_speaker_id": "12",  
  
  
    "max_duration_in_seconds": 50,  
    "min_duration_in_seconds": 1.0,  
    "max_tokens_length": 5000,  
  
    "model_name_or_path": "dhavalgala/mms-tts-ind-train",  
  
  
    "preprocessing_num_workers": 4,  
  
    "do_train": true,  
    "num_train_epochs": 200,  
    "gradient_accumulation_steps": 1,  
    "gradient_checkpointing": false,  
    "per_device_train_batch_size": 16,  
    "learning_rate": 2e-5,  
    "adam_beta1": 0.8,  
    "adam_beta2": 0.99,  
    "warmup_ratio": 0.01,  
    "group_by_length": false,  
  
    "do_eval": true,   
    "eval_steps": 50,  
    "per_device_eval_batch_size": 16,  
    "do_step_schedule_per_epoch": true,  
  
    "weight_disc": 3,  
    "weight_fmaps": 1,  
    "weight_gen": 1,  
    "weight_kl": 1.5,  
    "weight_duration": 1,  
    "weight_mel": 35,  
  
    "fp16": true,  
    "seed": 456  
}
```

#### 推理
只需几行代码，即可通过文本转语音 （TTS） 管道使用微调的模型！只需将 `ylacombe/vits_ljs_welsh_female_monospeaker_2` 替换为您自己的模型 ID （`hub_model_id`） 或模型的路径 （`output_dir`）。
```python
from transformers import pipeline
import scipy

model_id = "ylacombe/vits_ljs_welsh_female_monospeaker_2"
synthesiser = pipeline("text-to-speech", model_id) # add device=0 if you want to use a GPU

speech = synthesiser("Hello, my dog is cooler than you!")

scipy.io.wavfile.write("finetuned_output.wav", rate=speech["sampling_rate"], data=speech["audio"][0])
```


#### 问题
目前在推理时有一个关于 `speaker_id`的代码兼容性问题，需要将`run_vits_finetuning.py`文件里的所有 `speaker_id=batch["speaker_id"]` 代码注释掉。
注释后参考

```python
model_outputs_train = model(  
    input_ids=batch["input_ids"],  
    attention_mask=batch["attention_mask"],  
    labels=batch["labels"],  
    labels_attention_mask=batch["labels_attention_mask"],  
    # speaker_id=batch["speaker_id"],  
    return_dict=True,  
    monotonic_alignment_function=maximum_path,  
)
```
#### PS
- MMS 是由 Vineel Pratap、Andros Tjandra、Bowen Shi 等人在《 [Scaling Speech Technology to 1,000+ Languages](https://arxiv.org/abs/2305.13516)》中提出的。您可以在[MMS Language Coverage Overview](https://dl.fbaipublicfiles.com/mms/misc/language_coverage_mms.html)中找到有关受支持语言及其 ISO 639-3 代码的更多详细信息，并在 Hugging Face Hub 上查看所有 MMS-TTS 检查点：[facebook/mms-tts](https://huggingface.co/models?sort=trending&search=facebook%2Fmms-tts)。
- [Hugging Face 🤗 Transformers](https://huggingface.co/docs/transformers/index) 用于模型集成，[Hugging Face 🤗 Accelerate](https://huggingface.co/docs/accelerate/index) 用于分布式代码，[Hugging Face 🤗 datasets](https://huggingface.co/docs/datasets/index)用于方便数据集访问。