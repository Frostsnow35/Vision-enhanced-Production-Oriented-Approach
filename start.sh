#!/usr/bin/env bash
set -e

PORT="${PORT:-5000}"

# 检查端口是否被占用，占用则 kill
pid=$(lsof -ti ":$PORT" 2>/dev/null || true)
if [ -n "$pid" ]; then
    echo "⚠️  端口 $PORT 已被 PID $pid 占用，正在释放..."
    kill -9 $pid 2>/dev/null || true
    sleep 0.5
    echo "✅ 端口 $PORT 已释放"
fi

# 激活虚拟环境（如存在）
if [ -f venv/bin/activate ]; then
    source venv/bin/activate
elif [ -f .venv/bin/activate ]; then
    source .venv/bin/activate
fi

# 检查依赖
if ! python3 -c "import flask" 2>/dev/null; then
    echo "📦 安装依赖..."
    pip install -r requirements.txt
fi

echo "🚀 启动服务: http://localhost:$PORT"
python3 server.py
