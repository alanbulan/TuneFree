这里的 `invalid-update.bin` 是含 NUL 的固定测试文本，不是可执行文件。

`update-test.pub` 与 `invalid-update.bin.sig` 仅用于校验“签名通过，但安装包格式无效”的更新边界。测试签名使用独立临时密钥生成，私钥已删除，与正式更新签名无关。
