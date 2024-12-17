---
title: FreeSWITCH ASR 接口对接
description: 通过编写 ASR 模块，对接科大讯飞的实时语音转写 API
slug: fs-asr-api-connection
date: 2024-03-25 00:00:00+0000
image: cover.png
categories:
  - tech
tags:
  - FreeSWITCH
draft: false
---

## 定义 ASR 模块

在当前的外呼平台中，实时 ASR（语音识别）已成为一种常见的基础功能。尽管接触 FreeSWITCH 已有一段时间，但此前一直未进行 ASR 模块的定制化开发，仅通过 GitHub 上的开源项目实现需求。然而，这些方案往往无法完全满足业务需求，例如需要对接不同厂商的 ASR 接口、支持定制化开发（如实时 ASR、文件 ASR、打断功能等）。因此，基于具体需求进行定制开发势在必行。

目前的一个需求是实现 FreeSWITCH 的语音实时识别，采用的方案是通过 WebSocket 传输语音帧进行识别，具体可以通过以下方式实现。

### 基础代码

Freeswitch 的 ASR 模块也是通过 media_bug 来实现的。
FreeSWITCH 定义的模块，需要定义下面的这 3 个方法。分别定义模块加载、卸载和模块定义。

主要关注模块加载方法，定义了这个模块在 ASR 生命周期里的接口实现。
```cpp
extern "C"
{
    // 模块定义，分别是模块加载、模块卸载
    SWITCH_MODULE_LOAD_FUNCTION(mod_iflytekasr_load);
    SWITCH_MODULE_SHUTDOWN_FUNCTION(mod_iflytekasr_shutdown);
    SWITCH_MODULE_DEFINITION(mod_iflytekasr, mod_iflytekasr_load, mod_iflytekasr_shutdown, NULL);
}

// 模块加载
SWITCH_MODULE_LOAD_FUNCTION(mod_iflytekasr_load)
{
    switch_asr_interface_t *asr_interface;

    switch_mutex_init(&MUTEX, SWITCH_MUTEX_NESTED, pool);
    globals.pool = pool;

    switch_mutex_lock(MUTEX);
    iflytekasr_load_config();
    switch_mutex_unlock(MUTEX);

    /* connect my internal structure to the blank pointer passed to me */
    *module_interface = switch_loadable_module_create_module_interface(pool, modname);

    asr_interface = (switch_asr_interface_t *)switch_loadable_module_create_interface(*module_interface, SWITCH_ASR_INTERFACE);
    asr_interface->interface_name = "iflytekasr";
    asr_interface->asr_open = asr_open;
    asr_interface->asr_close = asr_close;
    asr_interface->asr_load_grammar = asr_load_grammar;
    asr_interface->asr_unload_grammar = asr_unload_grammar;
    asr_interface->asr_feed = asr_feed;
    asr_interface->asr_pause = asr_pause;
    asr_interface->asr_resume = asr_resume;
    asr_interface->asr_check_results = asr_check_results;
    asr_interface->asr_get_results = asr_get_results;
    asr_interface->asr_start_input_timers = asr_start_input_timers;
    asr_interface->asr_text_param = asr_text_param;
    asr_interface->asr_numeric_param = asr_numeric_param;
    asr_interface->asr_float_param = asr_float_param;

    /* indicate that the module should continue to be loaded */
    return SWITCH_STATUS_SUCCESS;

    *module_interface = switch_loadable_module_create_module_interface(pool, modname);

    switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_INFO, "iflytekasr mod loaded version 1.1 since 20241024.\n");
    return SWITCH_STATUS_SUCCESS;
}

// 模块卸载
SWITCH_MODULE_SHUTDOWN_FUNCTION(mod_iflytekasr_shutdown)
{
    switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_WARNING, "iflytekasr shutdown\n");
    return SWITCH_STATUS_UNLOAD;
}
```
### 接口实现

下列接口定义了一个 ASR 模块的完整生命周期及其功能。在 FreeSWITCH 中，这些接口可用于与第三方 ASR API（如科大讯飞、Google Speech-to-Text 等）对接，负责从初始化到关闭的各种操作。以下是各接口的具体作用：

​	1.asr_open：ASR 启动时执行，初始化 ASR 模块并建立连接。

​	2.asr_close：ASR 关闭时执行，关闭 ASR 模块并释放资源。

​	3.asr_load_grammar：在初始化资源之后执行，加载语法或语言模型。在开始 ASR 开启命令，可以加载一些外部传递来的参数，最终会传递到该接口解析。命令格式为 `detect_speech <mod_name> <gram_name> <gram_path> [<addr>]`

​	4.asr_unload_grammar：在 close 方法前执行，卸载语法或语言模型，释放资源。

​	5.asr_feed：在拨打过程中，向 ASR API 传递语音数据帧。

​	6.asr_pause：暂停当前语音识别任务。

​	7.asr_resume：恢复暂停的语音识别任务。

​	8.asr_check_results：检查识别结果是否已生成。**注意：这个方法的实现要保证幂等性。在asr_get_results方法被调用之前，这个方法多次调用的结果要保持一致**

​	9.asr_get_results：获取语音识别的最终结果。

​	10.asr_start_input_timers：启动输入计时器控制时间窗口。

​	11.asr_text_param：设置文本类型的配置参数。

​	12.asr_numeric_param：设置数值类型的配置参数。

​	13.asr_float_param：设置浮点类型的配置参数。

```cpp
// asr 模块开启时执行的方法，做一些初始化操作
static switch_status_t test_speech_open(switch_speech_handle_t *sh, const char *voice_name, int rate, int channels, switch_speech_flag_t *flags)
{
	test_tts_t *context = switch_core_alloc(sh->memory_pool, sizeof(test_tts_t));
	switch_assert(context);
	context->samples = sh->samplerate;
	sh->private_info = context;

	return SWITCH_STATUS_SUCCESS;
}

// close 时执行的方法，释放一些资源
static switch_status_t test_speech_close(switch_speech_handle_t *sh, switch_speech_flag_t *flags)
{
	return SWITCH_STATUS_SUCCESS;
}


// 通过查阅官方文档可以看到这个指令的格式为 detect_speech <mod_name> <gram_name> <gram_path> [<addr>]
/*! function to load a grammar to the asr interface */
static switch_status_t asr_load_grammar(switch_asr_handle_t *ah, const char *grammar, const char *name)
{
    test_asr_t *context = (test_asr_t *)ah->private_info;

	if (switch_test_flag(ah, SWITCH_ASR_FLAG_CLOSED)) {
		switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_ERROR, "asr_open attempt on CLOSED asr handle\n");
		return SWITCH_STATUS_FALSE;
	}

	switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_INFO, "load grammar %s\n", grammar);
	context->grammar = switch_core_strdup(ah->memory_pool, grammar);
	return SWITCH_STATUS_SUCCESS;
}

/*! function to unload a grammar to the asr interface */
static switch_status_t asr_unload_grammar(switch_asr_handle_t *ah, const char *name)
{
    return SWITCH_STATUS_SUCCESS;
}

// 接收语音流的方法
//  ASR 的 media_bug 会在 SWITCH_ABC_TYPE_READ 状态下调用这个方法。
/*! function to feed audio to the ASR */
static switch_status_t asr_feed(
    switch_asr_handle_t *ah, void *data, unsigned int len, switch_asr_flag_t *flags)
{
	test_asr_t *context = (test_asr_t *) ah->private_info;
	switch_status_t status = SWITCH_STATUS_SUCCESS;
	switch_vad_state_t vad_state;

	if (switch_test_flag(ah, SWITCH_ASR_FLAG_CLOSED)) {
		return SWITCH_STATUS_BREAK;
	}

	if (switch_test_flag(context, ASRFLAG_RETURNED_RESULT) && switch_test_flag(ah, SWITCH_ASR_FLAG_AUTO_RESUME)) {
		switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "Auto Resuming\n");
		test_asr_reset(context);
	}

	if (switch_test_flag(context, ASRFLAG_READY)) {
		vad_state = switch_vad_process(context->vad, (int16_t *)data, len / sizeof(uint16_t));
		if (vad_state == SWITCH_VAD_STATE_STOP_TALKING) {
			switch_set_flag(context, ASRFLAG_RESULT);
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_INFO, "Talking stopped, have result.\n");
			switch_vad_reset(context->vad);
			switch_clear_flag(context, ASRFLAG_READY);
		} else if (vad_state == SWITCH_VAD_STATE_START_TALKING) {
			switch_set_flag(context, ASRFLAG_START_OF_SPEECH);
			context->speech_time = switch_micro_time_now();
		}
	}

	return status;
}

// detect_speech resume 命令执行时会调用这个方法
/*! function to resume recognizer */
static switch_status_t asr_resume(switch_asr_handle_t *ah)
{
    test_asr_t *context = (test_asr_t *) ah->private_info;

	if (switch_test_flag(ah, SWITCH_ASR_FLAG_CLOSED)) {
		switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_ERROR, "asr_resume attempt on CLOSED asr handle\n");
		return SWITCH_STATUS_FALSE;
	}

	switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "Resuming\n");
	test_asr_reset(context);
	
	return SWITCH_STATUS_SUCCESS;
}

// detect_speech pause 命令执行时会调用这个方法
/*! function to pause recognizer */
static switch_status_t asr_pause(switch_asr_handle_t *ah)
{
    test_asr_t *context = (test_asr_t *) ah->private_info;

	if (switch_test_flag(ah, SWITCH_ASR_FLAG_CLOSED)) {
		switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_ERROR, "asr_pause attempt on CLOSED asr handle\n");
		return SWITCH_STATUS_FALSE;
	}

	switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "Pausing\n");
	context->flags = 0;

	return SWITCH_STATUS_SUCCESS;
}

// 检查是否获取到 ASR 结果的方法。每个语音帧都会调用。
// **注意：这个方法的实现要保证幂等性。在asr_get_results方法被调用之前，这个方法多次调用的结果要保持一致
/*! function to read results from the ASR*/
static switch_status_t asr_check_results(switch_asr_handle_t *ah, switch_asr_flag_t *flags)
{
    test_asr_t *context = (test_asr_t *) ah->private_info;

	if (switch_test_flag(context, ASRFLAG_RETURNED_RESULT) || switch_test_flag(ah, SWITCH_ASR_FLAG_CLOSED)) {
		return SWITCH_STATUS_BREAK;
	}

	if (!switch_test_flag(context, ASRFLAG_RETURNED_START_OF_SPEECH) && switch_test_flag(context, ASRFLAG_START_OF_SPEECH)) {
		return SWITCH_STATUS_SUCCESS;
	}

	if ((!switch_test_flag(context, ASRFLAG_RESULT)) && (!switch_test_flag(context, ASRFLAG_NOINPUT_TIMEOUT))) {
		if (switch_test_flag(context, ASRFLAG_INPUT_TIMERS) && !(switch_test_flag(context, ASRFLAG_START_OF_SPEECH)) &&
				context->no_input_timeout >= 0 &&
				(switch_micro_time_now() - context->no_input_time) / 1000 >= context->no_input_timeout) {
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "NO INPUT TIMEOUT %" SWITCH_TIME_T_FMT "ms\n", (switch_micro_time_now() - context->no_input_time) / 1000);
			switch_set_flag(context, ASRFLAG_NOINPUT_TIMEOUT);
		} else if (switch_test_flag(context, ASRFLAG_START_OF_SPEECH) && context->speech_timeout > 0 && (switch_micro_time_now() - context->speech_time) / 1000 >= context->speech_timeout) {
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "SPEECH TIMEOUT %" SWITCH_TIME_T_FMT "ms\n", (switch_micro_time_now() - context->speech_time) / 1000);
			if (switch_test_flag(context, ASRFLAG_START_OF_SPEECH)) {
				switch_set_flag(context, ASRFLAG_RESULT);
			} else {
				switch_set_flag(context, ASRFLAG_NOINPUT_TIMEOUT);
			}
		}
	}

	return switch_test_flag(context, ASRFLAG_RESULT) || switch_test_flag(context, ASRFLAG_NOINPUT_TIMEOUT) ? SWITCH_STATUS_SUCCESS : SWITCH_STATUS_BREAK;

}

// 获取识别加过的方法，识别结果复制给 xmlstr 这个指针。返回 true 时 Freeswitch 会对外发送 detected-speech 事件
/*! function to read results from the ASR */
static switch_status_t asr_get_results(switch_asr_handle_t *ah, char **xmlstr, switch_asr_flag_t *flags)
{
    udp_info_t *udp_info = (udp_info_t *)ah->private_info;
    switch_log_printf(SWITCH_CHANNEL_UUID_LOG(udp_info->uuid), SWITCH_LOG_INFO, "[[iflytekasr_callback-->asr_get_results]] get result start [%s] \n", udp_info->uuid);
    connection_metadata::ptr metadata_it = globals.endpoint->get_metadata(udp_info->uuid);

    switch_mutex_lock(udp_info->flag_mutex);

    int index = metadata_it->get_m_last_index();
    if (udp_info->seq == index)
    {
        return SWITCH_STATUS_FALSE;
    }
    udp_info->seq = index;
    switch_log_printf(SWITCH_CHANNEL_UUID_LOG(udp_info->uuid), SWITCH_LOG_INFO, "[[iflytekasr_callback-->asr_get_results]] get result get mutex [%s] \n", udp_info->uuid);

    *xmlstr = switch_mprintf("%s", get_switch_buffer_ptr(udp_info->text_buffer));
    switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_INFO, "[[iflytekasr_callback-->asr_get_result]] asr results is [%s] \n", *xmlstr);
    switch_buffer_zero(udp_info->text_buffer);

    switch_mutex_unlock(udp_info->flag_mutex);
    return SWITCH_STATUS_SUCCESS;
}

// 设置超时时间接口
/*! function to start input timeouts */
static switch_status_t asr_start_input_timers(switch_asr_handle_t *ah)
{
    	test_asr_t *context = (test_asr_t *) ah->private_info;

	if (switch_test_flag(ah, SWITCH_ASR_FLAG_CLOSED)) {
		switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_ERROR, "asr_start_input_timers attempt on CLOSED asr handle\n");
		return SWITCH_STATUS_FALSE;
	}

	switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "start_input_timers\n");

	if (!switch_test_flag(context, ASRFLAG_INPUT_TIMERS)) {
		switch_set_flag(context, ASRFLAG_INPUT_TIMERS);
		context->no_input_time = switch_micro_time_now();
	} else {
		switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_INFO, "Input timers already started\n");
	}

	return SWITCH_STATUS_SUCCESS;
}

// 加载参数
/*! set text parameter */
static void asr_text_param(switch_asr_handle_t *ah, char *param, const char *val)
{
test_asr_t *context = (test_asr_t *) ah->private_info;

	if (!zstr(param) && !zstr(val)) {
		int nval = atoi(val);
		double fval = atof(val);

		if (!strcasecmp("no-input-timeout", param) && switch_is_number(val)) {
			context->no_input_timeout = nval;
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "no-input-timeout = %d\n", context->no_input_timeout);
		} else if (!strcasecmp("speech-timeout", param) && switch_is_number(val)) {
			context->speech_timeout = nval;
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "speech-timeout = %d\n", context->speech_timeout);
		} else if (!strcasecmp("start-input-timers", param)) {
			context->start_input_timers = switch_true(val);
			if (context->start_input_timers) {
				switch_set_flag(context, ASRFLAG_INPUT_TIMERS);
			} else {
				switch_clear_flag(context, ASRFLAG_INPUT_TIMERS);
			}
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "start-input-timers = %d\n", context->start_input_timers);
		} else if (!strcasecmp("vad-mode", param)) {
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "vad-mode = %s\n", val);
			if (context->vad) switch_vad_set_mode(context->vad, nval);
		} else if (!strcasecmp("vad-voice-ms", param) && nval > 0) {
			context->voice_ms = nval;
			switch_vad_set_param(context->vad, "voice_ms", nval);
		} else if (!strcasecmp("vad-silence-ms", param) && nval > 0) {
			context->silence_ms = nval;
			switch_vad_set_param(context->vad, "silence_ms", nval);
		} else if (!strcasecmp("vad-thresh", param) && nval > 0) {
			context->thresh = nval;
			switch_vad_set_param(context->vad, "thresh", nval);
		} else if (!strcasecmp("channel-uuid", param)) {
			context->channel_uuid = switch_core_strdup(ah->memory_pool, val);
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "channel-uuid = %s\n", val);
		} else if (!strcasecmp("result", param)) {
			context->result_text = switch_core_strdup(ah->memory_pool, val);
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "result = %s\n", val);
		} else if (!strcasecmp("confidence", param) && fval >= 0.0) {
			context->result_confidence = fval;
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "confidence = %f\n", fval);
		} else if (!strcasecmp("partial", param) && switch_true(val)) {
			context->partial = 3;
			switch_log_printf(SWITCH_CHANNEL_UUID_LOG(context->channel_uuid), SWITCH_LOG_DEBUG, "partial = %d\n", context->partial);
		}
	}
}

/*! set numeric parameter */
static void asr_numeric_param(switch_asr_handle_t *ah, char *param, int val)
{
}

/*! set float parameter */
static void asr_float_param(switch_asr_handle_t *ah, char *param, double val)
{
}

```

### 配置文件

自定义模块的配置文件参考，可以在加载模块时读取一些配置，保存到模块的全局变量当中

```xml
<configuration name="iflytekasr.conf" description="ybs ws asr configuration">
  <settings>
    <param name="auto-reload" value="true"/>
    <!-- save the wave file for debug -->
    <param name="wav-file-dir" value="/data/tmp/iflytekasr/"/>
  </settings>
</configuration>
```



## WebSocketPP 模块

WebSocket 模块经过多种调研，选择使用了 [WebSocketPP](https://github.com/zaphoyd/websocketpp.git)。

Websocketpp 需要依赖 boost，CentOS 安装方法如下，其他分发版本可以参考官方文档

```sh
# 安装 boost
yum install boost

yum install boost-devel 

# 安装 websocketpp
git clone https://github.com/zaphoyd/websocketpp.git
cd websocketpp #进入目录
mkdir build && cd build
cmake .. #执行cmake
sudo make
sudo make install
```

### 测试 Demo

你可以进入该项目运行下面的脚本编译代码，启动 Server 端和 Client 端进行简单测试

```sh
cd ../examples/echo_server
g++ -o echo_server echo_server.cpp -lboost_system -lpthread   -std=c++11
#编译链接echo_server
./echo_server   
#启动服务器端

cd ../examples/echo_client    
#编译链接echo_client
g++ -o echo_client echo_client.cpp -lboost_system -lpthread   -std=c++11
#启动客户端
./echo_client
```

### 实现代码

下面代码定义了一个 `endpoint` 对象，提供了一些基础方法，如`send`、`close`等。该对象还维持了多个 WebSocket 链接对象，这些对象包含一些 如`on_message`的钩子方法。代码如下

```c++
#include <websocketpp/config/asio_no_tls_client.hpp>
#include <websocketpp/client.hpp>

#include <websocketpp/common/thread.hpp>
#include <websocketpp/common/memory.hpp>

typedef websocketpp::client<websocketpp::config::asio_client> client;

static switch_mutex_t *MUTEX = NULL;

class connection_metadata
{
public:
    typedef websocketpp::lib::shared_ptr<connection_metadata> ptr;

    connection_metadata(std::string uuid, websocketpp::connection_hdl hdl, std::string uri)
        : m_uuid(uuid), m_hdl(hdl), m_status("Connecting"), m_uri(uri), m_server("N/A")
    {
    }

    void on_open(client *c, websocketpp::connection_hdl hdl)
    {
        m_status = "Open";

        client::connection_ptr con = c->get_con_from_hdl(hdl);
        m_server = con->get_response_header("Server");
    }

    void on_fail(client *c, websocketpp::connection_hdl hdl)
    {
        m_status = "Failed";

        client::connection_ptr con = c->get_con_from_hdl(hdl);
        m_server = con->get_response_header("Server");
        m_error_reason = con->get_ec().message();
    }

    void on_close(client *c, websocketpp::connection_hdl hdl)
    {
        m_status = "Closed";
        client::connection_ptr con = c->get_con_from_hdl(hdl);
        std::stringstream s;
        s << "close code: " << con->get_remote_close_code() << " ("
          << websocketpp::close::status::get_string(con->get_remote_close_code())
          << "), close reason: " << con->get_remote_close_reason();
        m_error_reason = s.str();
    }

    void on_message(websocketpp::connection_hdl, client::message_ptr msg)
    {
        if (msg->get_opcode() == websocketpp::frame::opcode::text)
        {
            m_messages.push_back(msg->get_payload());
        }
        else
        {
            m_messages.push_back(websocketpp::utility::to_hex(msg->get_payload()));
        }

        // std::cout << "> recived message is: " << msg->get_payload() << "index is: " << m_messages.size() << std::endl;
    }

    websocketpp::connection_hdl get_hdl() const
    {
        return m_hdl;
    }

    std::string get_uuid() const
    {
        return m_uuid;
    }

    std::string get_status() const
    {
        return m_status;
    }

    int get_size()
    {
        return m_messages.size();
    }

    std::string get_message(int index)
    {
        return m_messages[index];
    }

    friend std::ostream &operator<<(std::ostream &out, connection_metadata const &data);

private:
    std::string m_uuid;
    websocketpp::connection_hdl m_hdl;
    std::string m_status;
    std::string m_uri;
    std::string m_server;
    std::string m_error_reason;
    std::vector<std::string> m_messages;
};

std::ostream &operator<<(std::ostream &out, connection_metadata const &data)
{
    out << "> URI: " << data.m_uri << "\n"
        << "> Status: " << data.m_status << "\n"
        << "> Remote Server: " << (data.m_server.empty() ? "None Specified" : data.m_server) << "\n"
        << "> Error/close reason: " << (data.m_error_reason.empty() ? "N/A" : data.m_error_reason) << "\n";
    out << "> Messages Processed: (" << data.m_messages.size() << ") \n";

    std::vector<std::string>::const_iterator it;
    for (it = data.m_messages.begin(); it != data.m_messages.end(); ++it)
    {
        out << *it << "\n";
    }

    return out;
}

class websocket_endpoint
{
public:
    websocket_endpoint() : m_next_id(0)
    {
        m_endpoint.clear_error_channels(websocketpp::log::elevel::none);
        m_endpoint.set_access_channels(websocketpp::log::alevel::none);
        m_endpoint.clear_access_channels(websocketpp::log::alevel::none);
        // m_endpoint.set_access_channels(websocketpp::log::alevel::all);
        // m_endpoint.clear_access_channels(websocketpp::log::alevel::frame_payload);

        m_endpoint.init_asio();
        m_endpoint.start_perpetual();

        m_thread = websocketpp::lib::make_shared<websocketpp::lib::thread>(&client::run, &m_endpoint);
    }

    ~websocket_endpoint()
    {

        m_endpoint.stop_perpetual();

        for (con_list::const_iterator it = m_connection_list.begin(); it != m_connection_list.end(); ++it)
        {
            if (it->second->get_status() != "Open")
            {
                // Only close open connections
                continue;
            }

            std::cout << "> Closing connection " << it->second->get_uuid() << std::endl;

            websocketpp::lib::error_code ec;
            m_endpoint.close(it->second->get_hdl(), websocketpp::close::status::going_away, "", ec);
            if (ec)
            {
                std::cout << "> Error closing connection " << it->second->get_uuid() << ": "
                          << ec.message() << std::endl;
            }
        }

        m_thread->join();
    }

    int connect(std::string uuid, std::string const &uri)
    {
        websocketpp::lib::error_code ec;

        client::connection_ptr con = m_endpoint.get_connection(uri, ec);

        if (ec)
        {
            std::cout << "> Connect initialization error: " << ec.message() << std::endl;
            return -1;
        }

        connection_metadata::ptr metadata_ptr = websocketpp::lib::make_shared<connection_metadata>(uuid, con->get_handle(), uri);
        m_connection_list[uuid] = metadata_ptr;

        con->set_open_handler(websocketpp::lib::bind(
            &connection_metadata::on_open,
            metadata_ptr,
            &m_endpoint,
            websocketpp::lib::placeholders::_1));
        con->set_fail_handler(websocketpp::lib::bind(
            &connection_metadata::on_fail,
            metadata_ptr,
            &m_endpoint,
            websocketpp::lib::placeholders::_1));
        con->set_close_handler(websocketpp::lib::bind(
            &connection_metadata::on_close,
            metadata_ptr,
            &m_endpoint,
            websocketpp::lib::placeholders::_1));
        con->set_message_handler(websocketpp::lib::bind(
            &connection_metadata::on_message,
            metadata_ptr,
            websocketpp::lib::placeholders::_1,
            websocketpp::lib::placeholders::_2));

        m_endpoint.connect(con);
        return 1;
    }

    void close(std::string uuid, websocketpp::close::status::value code, std::string reason)
    {
        websocketpp::lib::error_code ec;

        con_list::iterator metadata_it = m_connection_list.find(uuid);
        if (metadata_it == m_connection_list.end())
        {
            std::cout << "> No connection found with uuid " << uuid << std::endl;
            return;
        }

        m_endpoint.close(metadata_it->second->get_hdl(), code, reason, ec);
        if (ec)
        {
            std::cout << "> Error initiating close: " << ec.message() << std::endl;
        }
        m_connection_list.erase(uuid);
    }

    void send(std::string uuid, std::string message)
    {
        websocketpp::lib::error_code ec;

        con_list::iterator metadata_it = m_connection_list.find(uuid);
        if (metadata_it == m_connection_list.end())
        {
            std::cout << "> No connection found with uuid " << uuid << std::endl;
            return;
        }

        m_endpoint.send(metadata_it->second->get_hdl(), message, websocketpp::frame::opcode::text, ec);
        if (ec)
        {
            std::cout << "> Error sending message: " << ec.message() << std::endl;
            return;
        }
    }

    void sendBinary(std::string uuid, std::string message)
    {
        websocketpp::lib::error_code ec;

        con_list::iterator metadata_it = m_connection_list.find(uuid);
        if (metadata_it == m_connection_list.end())
        {
            std::cout << "> No connection found with uuid " << uuid << std::endl;
            return;
        }

        m_endpoint.send(metadata_it->second->get_hdl(), message, websocketpp::frame::opcode::binary, ec);
        if (ec)
        {
            std::cout << "> Error sending message: " << ec.message() << std::endl;
            return;
        }
    }

    connection_metadata::ptr get_metadata(std::string uuid) const
    {
        con_list::const_iterator metadata_it = m_connection_list.find(uuid);
        if (metadata_it == m_connection_list.end())
        {
            return connection_metadata::ptr();
        }
        else
        {
            return metadata_it->second;
        }
    }

private:
    typedef std::map<std::string, connection_metadata::ptr> con_list;

    client m_endpoint;

    websocketpp::lib::shared_ptr<websocketpp::lib::thread> m_thread;

    con_list m_connection_list;
    int m_next_id;
};
```



## 安装 mod_iflytekasr

Makefile 参考如下
```makefile
FREESWITCH_MOD_PATH=/usr/local/freeswitch/mod
MODNAME = mod_iflytekasr.so
MODOBJ = mod_iflytekasr.o base64.o
MODCFLAGS = -Wall -Wno-unused-function  -I/usr/src/freeswitch/src/include -I/usr/src/freeswitch/libs/libteletone/src -lboost_system -lpthread
CC = g++
CPPFLAGS = -fPIC -std=c++11 -g $(MODCFLAGS)
LDFLAGS = $(MODLDFLAGS)
all: $(MODNAME)
$(MODNAME): $(MODOBJ)
	@$(CC) -shared $(CPPFLAGS) -o $@ $(MODOBJ) $(LDFLAGS)
.PHONY: all clean
clean:
	rm -f $(MODNAME) $(MODOBJ)
install: $(MODNAME)
	install -d $(FREESWITCH_MOD_PATH)
	install $(MODNAME) $(FREESWITCH_MOD_PATH)
mod_iflytekasr.o: mod_iflytekasr.cpp
base64.o: base64.cpp base64.h
```



1. 在 ${FREESWITCH_SOURCE_ROOT}/modules.conf 添加以下两个模块

```
asr_tts/mod_iflytekasr
```

通过将以下行添加到 `${FREESWITCH_INSTALLATION_ROOT}/conf/autoload_configs/modules.conf.xml` 来激活 mod_iflytekasr
```xml
<load module="mod_iflytekasr"/>
```

2. 将模块复制到 `${FREESWITCH_SOURCE_ROOT}/src/mod/asr_tts/` 目录下

```sh
cd mod_iflytekasr
make install
```
3. 重启 freeswitch 加载模块

4. 复制以下lua脚本到`${FREESWITCH_INSTALLATION_ROOT}/scripts/`里

```lua
-- asr text for one round
local asr_text = nil;

-- 通话的事件都会回调这个接口
-- This is the input callback used by dtmf or any other events on this session such as ASR.
function onInput(s, type, obj)
    freeswitch.consoleLog("info", "Callback with type " .. type .. "\n");
    -- freeswitch.consoleLog("info", "s=" .. s .. "\n");
    freeswitch.consoleLog("info", "obj=" .. obj:serialize() .. "\n");

    if (type == "dtmf") then
        freeswitch.consoleLog("info", "DTMF Digit: " .. obj.digit .. "\n");
    elseif (type == "event") then
        local event = obj:getHeader("Speech-Type");
        if (event == "begin-speaking") then
            freeswitch.consoleLog("info", "speaking=" .. obj:serialize() .. "\n");
            -- Return break on begin-speaking events to stop playback of the fire or tts.
            return "break";
        end

        if (event == "detected-speech") then
            -- freeswitch.consoleLog("info", "\n" .. obj:serialize() .. "\n");
            local text = obj:getBody();
            if (text ~= "(null)") then
                -- Pause speech detection (this is on auto but pausing it just in case)
                session:execute("detect_speech", "pause");

                -- Parse the results from the event into the results table for later use.
                -- results = getResults(obj:getBody());

                -- set the global asr text for later use
                asr_text = text;
            end
            -- return "break";
        end
    end
end

session:answer();


-- Register the input callback
session:setInputCallback("onInput");
-- Sleep a little bit to get media time to be fully up
session:sleep(100);
session:streamFile("hello.wav");
session:execute("detect_speech", "test directory directory");

-- keep the thread alive
while (session:ready() == true) do
    if (asr_text == nil) then
        session:sleep(20);
    elseif (asr_text == "") then
        session:streamFile("I didn't hear you.wav");
        asr_text = nil;
        session:execute("detect_speech", "resume");
    else
        -- do your NLU here ?

        -- echo back the recognition result
        session:streamFile("Yes.wav");
        asr_text = nil;

        session:execute("detect_speech", "resume");
    end
end

-- stop the detect_speech and hangup
session:execute("detect_speech", "stop");
session:sleep(1000);
session:hangup();
```