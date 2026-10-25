# 固定扩展 ID

公钥已直接写入 `extension/manifest.json`。安装时只需选择 **`extension` 文件夹**，无需构建。

1. 打开 `chrome://extensions`，开启开发者模式。
2. 点击「加载已解压的扩展程序」，选择项目里的 `extension` 文件夹。
3. 检查 ID：`fhohijfjoehgofnnnghbgiglmaagemni`。

直接加载源码目录即可；`more-slots.zip` 只是同一批文件的便携副本，使用 ZIP 不是获得固定 ID 的条件。Mac、Windows 和不同目录的安装都会读取同一个 manifest 公钥。

以后更新 `extension` 中的文件，再在扩展管理页刷新即可。不要删除或修改 manifest 的 `key`。

第一次从旧的路径 ID 切换到这个固定 ID 时，请先在旧版中导出配置，切换后导入一次。已经使用上述固定 ID 的用户无需再次迁移。固定 ID 不会自动迁移另一个 ID 下的 Chrome 存储；从 1.4.0 开始可在设置中主动启用 [Chrome Sync](chrome-sync.md)。

如需检查仓库中的 ID，可运行 `npm run id:status`；日常安装和使用不需要 Node.js 或任何命令。

公钥可公开，私钥不在扩展目录、Git 仓库或安装包内。

参考：[Chrome manifest.key 文档](https://developer.chrome.com/docs/extensions/reference/manifest/key)。
