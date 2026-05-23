import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, MicOff, Send, ChevronRight, Loader2, User, Bot, RefreshCw } from 'lucide-react'

interface Message {
  id: string
  sender: 'user' | 'ai'
  content: string
  timestamp: Date
}

const mockAIResponses = [
  'Good afternoon! What can I get for you today?',
  'Our caramel macchiato is $5.00. Would you like that hot or iced?',
  'Great choice! It will be ready in about 4 minutes. Enjoy your day!',
]

export default function Attempt2Page() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [aiResponseIndex, setAiResponseIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const initialMessage: Message = {
      id: '1',
      sender: 'ai',
      content: mockAIResponses[0],
      timestamp: new Date()
    }
    setMessages([initialMessage])
    setAiResponseIndex(1)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!inputValue.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      sender: 'user',
      content: inputValue,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    setTimeout(() => {
      if (aiResponseIndex < mockAIResponses.length) {
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          content: mockAIResponses[aiResponseIndex],
          timestamp: new Date()
        }
        setMessages(prev => [...prev, aiMessage])
        setAiResponseIndex(prev => prev + 1)
      }
      setIsLoading(false)
    }, 1000)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleRecording = () => {
    setIsRecording(!isRecording)
  }

  const handleSubmit = () => {
    localStorage.setItem('attempt2Messages', JSON.stringify(messages))
    window.location.href = '/evaluate'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium mb-4">
            <RefreshCw className="w-4 h-4" />
            迁移交际任务
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">产出验证</h1>
          <p className="text-gray-600">在相同场景下完成新情节的对话，验证你的学习成果</p>
        </div>

        <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4 mb-6">
          <p className="text-amber-800 text-sm">
            <strong>提示：</strong>尝试运用你在"输入促成"阶段学到的礼貌用语和交际策略，对比第一次对话看看有什么进步。
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-green-600 to-emerald-600 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-semibold">AI服务员</p>
                <p className="text-white/70 text-sm">新情节对话练习</p>
              </div>
            </div>
          </div>

          <div className="h-96 overflow-y-auto p-4 space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex gap-3 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  message.sender === 'user' ? 'bg-green-600' : 'bg-gray-200'
                }`}>
                  {message.sender === 'user' ? (
                    <User className="w-4 h-4 text-white" />
                  ) : (
                    <Bot className="w-4 h-4 text-gray-600" />
                  )}
                </div>
                <div className={`max-w-xs md:max-w-sm px-4 py-3 rounded-2xl ${
                  message.sender === 'user' 
                    ? 'bg-green-600 text-white rounded-br-md' 
                    : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}>
                  <p>{message.content}</p>
                  <p className={`text-xs mt-1 ${
                    message.sender === 'user' ? 'text-white/60' : 'text-gray-500'
                  }`}>
                    {message.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start gap-3">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-gray-600" />
                </div>
                <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-md">
                  <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-gray-100 p-4">
            <div className="flex items-center gap-3">
              <Button 
                variant="outline" 
                size="icon"
                onClick={handleRecording}
                className={`rounded-full ${isRecording ? 'bg-red-100 text-red-600 border-red-200' : ''}`}
              >
                {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </Button>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="输入你的对话内容..."
                className="flex-1 px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <Button 
                size="icon"
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="bg-green-600 hover:bg-green-700 rounded-full"
              >
                <Send className="w-5 h-5" />
              </Button>
            </div>
            {isRecording && (
              <p className="text-red-500 text-sm mt-2">正在录音...</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <Button 
            size="lg" 
            className="bg-green-600 hover:bg-green-700 text-white px-8"
            onClick={handleSubmit}
          >
            完成对话，查看评价
            <ChevronRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}