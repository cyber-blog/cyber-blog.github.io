---
title: Freeswitch ASR 接口对接
description: Freeswitch ASR 接口对接
slug: fs-asr-api-connection
date: 2022-10-09 00:00:00+0000
image: cover.jpg
categories:
    - tech
tags:
    - FreeSWITCH
draft: true
---

# Freeswitch asr_interface 模块开发

对于现在的外呼平台，实时 ASR 也是比较常见基础的功能。接触 Freeswitch 这么久一直没有定制开发过 ASR 模块，之前是在 Github 上找一些开源的进行使用，但是也往往不满足业务需求（比如需要对接不同厂商的 ASR 接口、定制化开发实时 ASR 或文件 ASR 、打断等），还是需要定制开发。
所以这是第一次开发这个模块Freeswitch 的 ASR 模块。特此记录。

## 基础代码
Freeswitch 的 ASR 模块也是通过 media_bug 来实现的。
ASR 模块需要定义下面的这 3 个方法。分别定义模块加载、卸载和模块定义。

主要关注模块加载方法，定义了这个模块在 ASR 生命周期里的各种实现。
```cpp
extern "C"
{
    // 模块定义，分别是模块加载、模块卸载
    SWITCH_MODULE_LOAD_FUNCTION(mod_ybsasr_load);
    SWITCH_MODULE_SHUTDOWN_FUNCTION(mod_ybsasr_shutdown);
    SWITCH_MODULE_DEFINITION(mod_ybsasr, mod_ybsasr_load, mod_ybsasr_shutdown, NULL);
}

// 模块加载
SWITCH_MODULE_LOAD_FUNCTION(mod_ybsasr_load)
{
    	switch_asr_interface_t *asr_interface;
	switch_speech_interface_t *speech_interface = NULL;

	*module_interface = switch_loadable_module_create_module_interface(pool, modname);

	asr_interface = switch_loadable_module_create_interface(*module_interface, SWITCH_ASR_INTERFACE);
	asr_interface->interface_name = "test";
	asr_interface->asr_open = test_asr_open;
	asr_interface->asr_load_grammar = test_asr_load_grammar;
	asr_interface->asr_unload_grammar = test_asr_unload_grammar;
	asr_interface->asr_close = test_asr_close;
	asr_interface->asr_feed = test_asr_feed;
	asr_interface->asr_resume = test_asr_resume;
	asr_interface->asr_pause = test_asr_pause;
	asr_interface->asr_check_results = test_asr_check_results;
	asr_interface->asr_get_results = test_asr_get_results;
	asr_interface->asr_start_input_timers = test_asr_start_input_timers;
	asr_interface->asr_text_param = test_asr_text_param;

	speech_interface = switch_loadable_module_create_interface(*module_interface, SWITCH_SPEECH_INTERFACE);
	speech_interface->interface_name = "test";
	speech_interface->speech_open = test_speech_open;
	speech_interface->speech_close = test_speech_close;
	speech_interface->speech_feed_tts = test_speech_feed_tts;
	speech_interface->speech_read_tts = test_speech_read_tts;
	speech_interface->speech_flush_tts = test_speech_flush_tts;
	speech_interface->speech_text_param_tts = test_speech_text_param_tts;
	speech_interface->speech_numeric_param_tts = test_speech_numeric_param_tts;
	speech_interface->speech_float_param_tts = test_speech_float_param_tts;

	return SWITCH_STATUS_SUCCESS;
}

// 模块卸载
SWITCH_MODULE_SHUTDOWN_FUNCTION(mod_ybsasr_shutdown)
{
    switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_WARNING, "ybsasr shutdown\n");
    return SWITCH_STATUS_UNLOAD;
}
```
## 接口实现

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


// asr_load_grammar 接口会在执行 detect_speech ybsasr directory directory 时执行
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
    switch_log_printf(SWITCH_CHANNEL_UUID_LOG(udp_info->uuid), SWITCH_LOG_INFO, "[[ybsasr_callback-->asr_get_results]] get result start [%s] \n", udp_info->uuid);
    connection_metadata::ptr metadata_it = globals.endpoint->get_metadata(udp_info->uuid);

    switch_mutex_lock(udp_info->flag_mutex);

    int index = metadata_it->get_m_last_index();
    if (udp_info->seq == index)
    {
        return SWITCH_STATUS_FALSE;
    }
    udp_info->seq = index;
    switch_log_printf(SWITCH_CHANNEL_UUID_LOG(udp_info->uuid), SWITCH_LOG_INFO, "[[ybsasr_callback-->asr_get_results]] get result get mutex [%s] \n", udp_info->uuid);

    *xmlstr = switch_mprintf("%s", get_switch_buffer_ptr(udp_info->text_buffer));
    switch_log_printf(SWITCH_CHANNEL_LOG, SWITCH_LOG_INFO, "[[ybsasr_callback-->asr_get_result]] asr results is [%s] \n", *xmlstr);
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

## 安装和使用

Makefile 参考
```c
BASE=../../../..
#BASE=/usr/src/freeswitch

include $(BASE)/build/modmake.rules

LOCAL_LDFLAGS = -lfaac -lmp4v2
```
1. 在 ${FREESWITCH_SOURCE_ROOT}/modules.conf 添加模块
```
asr_tts/mod_test
```

重新编译并安装 freeswitch 以安装 mod_test
通过将以下行添加到${FREESWITCH_INSTALLATION_ROOT}/conf/autoload_configs/modules.conf.xml 来激活 mod_test
```
<load module="mod_test"/>
```
2. 复制以下lua脚本 ${PROJECT_ROOT}/scripts到${FREESWITCH_INSTALLATION_ROOT}/scripts/里

```lua
-- asr text for one round
local asr_text = nil;


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