# 免费固定开发者模式扩展 ID

项目公钥已保存到 `config/extension-identity.json`。固定 ID：

```text
fhohijfjoehgofnnnghbgiglmaagemni
```

公钥可以提交到 Git。生成时的私钥只保存在被忽略的 `.local/extension-private.pem`，不进入仓库或安装包。另一台设备构建时使用仓库里现有的公钥，不会重新生成身份。

## 第一次切换

1. 在当前旧版扩展里打开「自定义 More Slots → 导出备份」，保存好 JSON 文件。先保留旧扩展。
2. 使用已经生成的 `more-slots-fixed.zip`，解压到准备长期保留的位置；或者在项目根目录运行 `npm run build:fixed`，生成 `dist/extension`。
3. 打开 `chrome://extensions`，点击「加载已解压的扩展程序」，选择解压后的包含 `manifest.json` 的文件夹，或构建生成的 `dist/extension`。不要选择原来的 `extension` 源目录。
4. 在扩展管理页检查新安装的 ID 是否与上面一致。旧版和固定 ID 版可能同时存在，按 ID 区分。
5. 新开标签页，在固定 ID 版的设置里导入第 1 步的备份。需要书签栏时，再点一次「启用书签栏」允许权限。
6. 确认快捷方式、排序和设置正常后，关闭旧版扩展。保留备份，不必急于卸载旧版。

Mac 和 Windows 加载同一个固定 ID 包即可获得相同 ID，不需要在两台设备使用相同的文件路径，不需要注册 Chrome 商店开发者。

## 后续更新

更新源码后运行：

```sh
npm run build:fixed
```

然后在 `chrome://extensions` 刷新已有的固定 ID 安装。构建会重新生成 `dist/extension`，公钥和 ID 保持不变。不要删除或重新生成 `config/extension-identity.json`。

原 `extension/manifest.json` 保持原样，方便旧版用户先导出数据；构建脚本只给生成目录的 manifest 添加公钥。构建不会自动替换你正在使用的旧版，也不会自动迁移 Chrome 存储。

如果只想查看 ID：

```sh
npm run id:status
```

固定 ID 只是跨设备识别同一扩展的前提。目前尚未实现 Chrome Sync，安装固定 ID 版本不会自动开始同步。

参考：[Chrome manifest.key 文档](https://developer.chrome.com/docs/extensions/reference/manifest/key)、[Chromium ID 计算实现](https://github.com/chromium/chromium/blob/main/extensions/common/extension.cc)。
