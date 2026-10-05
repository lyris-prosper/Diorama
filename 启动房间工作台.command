#!/bin/zsh
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
npm start
if [ $? -ne 0 ]; then
  echo "启动未完成，请查看上方提示。按回车关闭。"
  read
fi
