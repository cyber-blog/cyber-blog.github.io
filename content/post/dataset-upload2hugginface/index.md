---
title: 音频文件打包 Dataset 上传 HugginFace
slug: dataset-upload2hugginface
date: 2024-07-01 00:00:00+0000
categories:
  - tech
tags:
  - Python
  - AIGC
draft: false
---
### 打包Dataset
之前在使用 [finetune-hf-vits](https://github.com/ylacombe/finetune-hf-vits) 项目微调 `MMS-TTS` 的印尼语模型的时候，该项目会读取 HuggingFace 的数据集，需要将本地的数据集上传到 HuggingFace。
HugginFace 的数据集是 parquet 格式。可以使用 Hugging Face 官方提供的包生成。

```python
path = "your-path"  
# 读取 Excel 文件  
excel_file_path = os.path.join(path, 'FEMALE VOICE 2 .xlsx')  
df = pd.read_excel(excel_file_path)  
  
# 处理音频路径  
df['audio'] = df['audio'].apply(lambda x: load_audio_file_to_bytes(x) if isinstance(x, str) and x else None)  
  
# 转换 DataFrame 为字典格式  
data_dict = df[['text', 'audio', 'speaker_id']].to_dict(orient='list')  
  
# 定义数据集特征，使用 Audio 类型  
features = Features({  
    'text': Value('string'),  
    'audio': Audio(sampling_rate=None),  # 这里定义音频特征  
    'speaker_id': Value('string')  
})  
  
# 创建 Dataset 对象  
dataset = Dataset.from_dict(data_dict, features=features)
  
# 保存为 Hugging Face 的数据集格式  
dataset.push_to_hub("Majiang213/ind_female")
```

通过代码可以看到，我的数据保存格式是一个 Excel 文件，里面有 text 列，为音频的文本，audio 列为文件路径，speaker_id 列为声音 id。在读取 Excel 之后，将音频路径转换为了实际的音频数据。然后将 `Pandas DataFrame` 对象转换为了一个字典，通过 Hugging Face 包的 `Dataset` 对象，进行转换，并上传。

另外不要忘记使用该命令登录
```shell
huggingface-cli login
```


这是读取音频数据的代码和需要引入的包

```python
import io  
import os  
  
import librosa  
import pandas as pd  
import soundfile as sf  
from datasets import Dataset, Audio, Value, Features  
from pydub import AudioSegment


def load_audio_file_to_bytes(audio_path):  
    audio_path = os.path.join(path, audio_path)  
    # 获取文件扩展名  
    file_extension = audio_path.split('.')[-1].lower()  
  
    # 创建一个字节流对象  
    audio_bytes = io.BytesIO()  
  
    # 处理不同格式的音频文件  
    if file_extension in ['mp3', 'm4a']:  
        # 使用 pydub 读取 MP3 或 M4A 文件  
        audio = AudioSegment.from_file(audio_path, format=file_extension)  
        # 直接保存音频数据到字节流  
        audio.export(audio_bytes, format='wav')  
  
    elif file_extension in ['wav', 'flac', 'ogg']:  
        # 使用 librosa 直接读取音频文件  
        y, sr = librosa.load(audio_path, sr=None)  
        # 将 NumPy 数组转换为 int16 类型并写入字节流  
        sf.write(audio_bytes, y, sr, format='WAV')  
  
    else:  
        raise ValueError(f"Unsupported file format: {file_extension}")  
  
    # 移动流的指针到起始位置，以便后续读取  
    audio_bytes.seek(0)  
  
    return audio_bytes.getvalue()
```

#### PS
另外推荐一个处理音频文件的 Python 小工具 [audio-preprocess](https://github.com/fishaudio/audio-preprocess)。
这个 Repo 包含了一些用于处理音频的脚本. 主要包含以下功能:

- [x]  视频/音频转 wav
- [x]  音频人声分离
- [x]  音频自动切片
- [x]  音频响度匹配
- [x]  音频数据统计（支持判断音频长度）
- [x]  音频重采样
- [x]  音频打标 (.lab)
- [x]  音频打标 FunASR（使用 `--model-type funasr` 开启, 详细使用方法可查看代码）
- [ ]  音频打标 WhisperX
- [ ]  .lab 标注合并为 .list 文件 (示例: `fap merge-lab ./dataset list.txt "{PATH}|spkname|JP|{TEXT}"`)

([ ] 表示未完成, [x] 表示已完成)

##### 使用方式参考
```sh
pip install -e .
fap --help
```