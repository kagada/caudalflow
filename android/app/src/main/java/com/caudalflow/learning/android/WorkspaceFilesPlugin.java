package com.caudalflow.learning.android;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

// 原生层仅管理内部文件、系统文档选择和剪贴板，不承载工作区 SQL 或保存规则。
@CapacitorPlugin(name = "WorkspaceFiles")
public class WorkspaceFilesPlugin extends Plugin {
    private static final long MAX_BYTES = 512L * 1024 * 1024;

    private File databaseFile(String name) throws Exception {
        if (name == null || !name.matches("w_[a-f0-9]{32}")) throw new Exception("内部工作区名称无效");
        File file = getContext().getDatabasePath(name + "SQLite.db");
        File directory = file.getParentFile();
        if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) throw new Exception("不能创建工作区目录");
        return file;
    }

    private File historyFile(String key) throws Exception {
        if (key == null || !key.matches("[a-f0-9]{64}")) throw new Exception("历史名称无效");
        return getContext().getDatabasePath("history_" + key + ".sqlite");
    }

    private JSObject describe(String name) throws Exception {
        JSObject result = new JSObject();
        result.put("database", name);
        result.put("path", databaseFile(name).getAbsolutePath());
        return result;
    }

    // 在驱动打开前拒绝旧 JSON 和其他 SQLite 文件；第 3 版由共用业务升级。
    private void validate(File file) throws Exception {
        try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
            if (input.length() < 100) throw new Exception("所选文件不是完整的 SQLite 工作区");
            byte[] magic = new byte[16];
            input.readFully(magic);
            if (!new String(magic, StandardCharsets.US_ASCII).equals("SQLite format 3\0")) throw new Exception("请选择 SQLite 工作区文件，不能导入旧 JSON");
            input.seek(60); int version = input.readInt();
            input.seek(68); int appId = input.readInt();
            if (appId != 0x43464c57 || (version != 3 && version != 4)) throw new Exception("不支持的 CaudalFlow 工作区格式或版本");
        }
    }

    private void copy(InputStream input, OutputStream output) throws Exception {
        byte[] buffer = new byte[64 * 1024];
        long bytes = 0; int count;
        while ((count = input.read(buffer)) != -1) {
            bytes += count;
            if (bytes > MAX_BYTES) throw new Exception("本版单个工作区文件上限为 512 MiB");
            output.write(buffer, 0, count);
        }
        output.flush();
    }

    @PluginMethod
    public void location(PluginCall call) {
        try { call.resolve(describe(call.getString("database"))); }
        catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void historyPath(PluginCall call) {
        try {
            JSObject result = new JSObject(); result.put("path", historyFile(call.getString("key")).getAbsolutePath());
            call.resolve(result);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void pickWorkspace(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_TITLE, "导入 SQLite 工作区副本");
        startActivityForResult(call, intent, "workspacePicked");
    }

    @ActivityCallback
    private void workspacePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject(); cancelled.put("cancelled", true); call.resolve(cancelled); return;
        }
        // Activity 回调在界面线程，文件复制交给后台执行，避免大工作区阻塞界面。
        getBridge().execute(() -> {
        File target = null;
        try {
            Uri uri = result.getData().getData();
            if (uri == null) throw new Exception("没有获得文件访问凭据");
            String name = "w_" + UUID.randomUUID().toString().replace("-", "");
            target = databaseFile(name);
            try (InputStream source = getContext().getContentResolver().openInputStream(uri);
                 FileOutputStream destination = new FileOutputStream(target)) {
                if (source == null) throw new Exception("不能读取所选文件");
                copy(source, destination); destination.getFD().sync();
            }
            validate(target);
            call.resolve(describe(name));
        } catch (Exception error) {
            if (target != null) target.delete();
            call.reject(error.getMessage(), error);
        }
        });
    }

    // JavaScript 先用 VACUUM INTO 生成关闭的快照，避免复制正在写入的数据库。
    @PluginMethod
    public void exportWorkspace(PluginCall call) {
        try {
            validate(databaseFile(call.getString("database")));
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/octet-stream");
            intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "workspace.caudalflow").replaceAll("[/\\\\]", "_"));
            startActivityForResult(call, intent, "exportPicked");
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @ActivityCallback
    private void exportPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject(); cancelled.put("cancelled", true); call.resolve(cancelled); return;
        }
        getBridge().execute(() -> {
        Uri uri = result.getData().getData();
        try {
            if (uri == null) throw new Exception("没有获得导出位置");
            try (FileInputStream source = new FileInputStream(databaseFile(call.getString("database")));
                 OutputStream target = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (target == null) throw new Exception("不能写入所选位置");
                copy(source, target);
            }
            call.resolve();
        } catch (Exception error) {
            if (uri != null) try { android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); } catch (Exception ignored) { }
            call.reject(error.getMessage(), error);
        }
        });
    }

    // 只清理内部名称对应的文件；用户选择的外部原文件从不进入删除范围。
    @PluginMethod
    public void removeWorkspace(PluginCall call) {
        try {
            File file = databaseFile(call.getString("database"));
            if (file.exists() && !getContext().deleteDatabase(file.getName())) throw new Exception("不能删除内部工作区");
            String key = call.getString("historyKey");
            if (key != null) {
                File history = historyFile(key);
                if (history.exists() && !getContext().deleteDatabase(history.getName())) throw new Exception("不能删除个人历史");
            }
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public void writeClipboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard == null) throw new Exception("剪贴板不可用");
                clipboard.setPrimaryClip(ClipData.newHtmlText("CaudalFlow 引用", call.getString("text", ""), call.getString("html", "")));
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
}
