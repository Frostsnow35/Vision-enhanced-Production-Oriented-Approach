import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronRight, CheckCircle2, XCircle, Lightbulb, BookOpen, MessageCircle, ArrowRight } from 'lucide-react'

interface Gap {
  id: string
  type: string
  evidence: string
  consequence: string
  target_improvement: string
}

interface Exercise {
  id: string
  question: string
  options: string[]
  correctAnswer: number
  explanation: string
}

const mockGaps: Gap[] = [
  {
    id: '1',
    type: '语用得体性',
    evidence: '使用了直接命令式语言 "Give me a latte"',
    consequence: '在服务场景中显得不够礼貌，可能让服务员感到被冒犯',
    target_improvement: '使用更礼貌的请求句式，如 "Could I have..." 或 "May I order..."'
  },
  {
    id: '2',
    type: '词汇多样性',
    evidence: '重复使用 "coffee" 一词，未使用 "latte", "espresso" 等具体词汇',
    consequence: '表达显得单调，未能充分展示词汇能力',
    target_improvement: '学习和使用咖啡相关的专业词汇'
  },
  {
    id: '3',
    type: '话轮适配',
    evidence: '回答简短，未能自然延续对话',
    consequence: '对话显得生硬，缺乏交流感',
    target_improvement: '适当扩展回答，加入感谢或额外问题'
  }
]

const mockInputPack = {
  vocabulary: [
    { word: 'Could I have...', meaning: '我可以要...吗？（礼貌请求）' },
    { word: 'May I order...', meaning: '我可以点...吗？（礼貌请求）' },
    { word: 'Latte', meaning: '拿铁咖啡' },
    { word: 'Espresso', meaning: '浓缩咖啡' },
    { word: 'Caramel macchiato', meaning: '焦糖玛奇朵' },
    { word: 'Please', meaning: '请（礼貌用语）' },
    { word: 'Thank you', meaning: '谢谢' },
    { word: 'You\'re welcome', meaning: '不客气' }
  ],
  patterns: [
    'Could I have a [drink] please?',
    'May I order a [drink]?',
    'How much does the [drink] cost?',
    'Thank you very much!'
  ],
  modelDialogue: [
    { speaker: 'Customer', text: 'Good morning! Could I have a latte please?' },
    { speaker: 'Barista', text: 'Certainly! That will be $4.50.' },
    { speaker: 'Customer', text: 'Thank you! Could you make it hot?' },
    { speaker: 'Barista', text: 'Absolutely! It\'ll be ready in 3 minutes.' },
    { speaker: 'Customer', text: 'Great, thank you very much!' }
  ],
  strategies: [
    '使用 "Could I..." 或 "May I..." 开头的礼貌句式',
    '在请求后加上 "please"',
    '收到服务后记得说 "thank you"',
    '可以适当询问额外信息，如温度、配料等'
  ]
}

const mockExercises: Exercise[] = [
  {
    id: '1',
    question: '选择最礼貌的点餐方式：',
    options: [
      'Give me a coffee.',
      'I want a coffee.',
      'Could I have a coffee please?',
      'Coffee, now!'
    ],
    correctAnswer: 2,
    explanation: '使用 "Could I have..." 是最礼貌的请求方式，加上 "please" 更加得体。'
  },
  {
    id: '2',
    question: '服务员说 "That will be $4.50"，你应该如何回应？',
    options: [
      'OK.',
      'Here you are. Thank you!',
      'Give me the coffee first.',
      'Too expensive.'
    ],
    correctAnswer: 1,
    explanation: '支付时应该表示感谢，"Here you are" 表示递钱，加上 "Thank you" 显得礼貌。'
  },
  {
    id: '3',
    question: '当服务员问 "Would you like anything else?"，最合适的回答是：',
    options: [
      'No.',
      'No, thank you.',
      'Nope.',
      'I\'m good.'
    ],
    correctAnswer: 1,
    explanation: '"No, thank you." 是最礼貌的拒绝方式，即使不需要其他东西也要表示感谢。'
  }
]

export default function FacilitatePage() {
  const [activeTab, setActiveTab] = useState<'diagnosis' | 'input' | 'exercise'>('diagnosis')
  const [selectedAnswers, setSelectedAnswers] = useState<(number | null)[]>(Array(mockExercises.length).fill(null))
  const [showResults, setShowResults] = useState(false)
  const [completed, setCompleted] = useState(false)

  const handleAnswer = (index: number, answer: number) => {
    const newAnswers = [...selectedAnswers]
    newAnswers[index] = answer
    setSelectedAnswers(newAnswers)
  }

  const checkAnswers = () => {
    setShowResults(true)
    const allCorrect = selectedAnswers.every((answer, index) => answer === mockExercises[index].correctAnswer)
    if (allCorrect) {
      setCompleted(true)
    }
  }

  const handleContinue = () => {
    localStorage.setItem('gaps', JSON.stringify(mockGaps))
    window.location.href = '/attempt2'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">诊断与促成</h1>
          <p className="text-gray-600">根据你的对话表现，我们发现了以下需要改进的方面</p>
        </div>

        <div className="flex justify-center mb-8 bg-white rounded-xl p-1 shadow-sm border border-gray-100">
          <Button
            variant={activeTab === 'diagnosis' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('diagnosis')}
            className="rounded-lg"
          >
            <Lightbulb className="w-4 h-4 mr-2" />
            诊断摘要
          </Button>
          <Button
            variant={activeTab === 'input' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('input')}
            className="rounded-lg"
          >
            <BookOpen className="w-4 h-4 mr-2" />
            输入材料
          </Button>
          <Button
            variant={activeTab === 'exercise' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('exercise')}
            className="rounded-lg"
          >
            <MessageCircle className="w-4 h-4 mr-2" />
            练习区
          </Button>
        </div>

        {activeTab === 'diagnosis' && (
          <div className="space-y-4">
            {mockGaps.map((gap) => (
              <div key={gap.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-start justify-between mb-4">
                  <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
                    {gap.type}
                  </span>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">问题表现</p>
                    <p className="text-gray-800">{gap.evidence}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">影响</p>
                    <p className="text-gray-700">{gap.consequence}</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4">
                    <p className="text-sm text-green-700 font-medium mb-1">改进目标</p>
                    <p className="text-green-800">{gap.target_improvement}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'input' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">场景词块</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {mockInputPack.vocabulary.map((item, index) => (
                  <div key={index} className="bg-indigo-50 rounded-xl p-3">
                    <p className="font-medium text-indigo-800">{item.word}</p>
                    <p className="text-sm text-indigo-600">{item.meaning}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">功能句式</h3>
              <div className="space-y-2">
                {mockInputPack.patterns.map((pattern, index) => (
                  <div key={index} className="bg-purple-50 rounded-xl px-4 py-3">
                    <p className="text-purple-800 font-mono">{pattern}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">示范对话</h3>
              <div className="space-y-3">
                {mockInputPack.modelDialogue.map((dialogue, index) => (
                  <div key={index} className={`flex gap-3 ${dialogue.speaker === 'Customer' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`px-4 py-2 rounded-xl ${
                      dialogue.speaker === 'Customer' 
                        ? 'bg-indigo-600 text-white rounded-br-md' 
                        : 'bg-gray-100 text-gray-800 rounded-bl-md'
                    }`}>
                      <p className="text-sm font-medium mb-1">{dialogue.speaker}</p>
                      <p>{dialogue.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">交际策略要点</h3>
              <ul className="space-y-2">
                {mockInputPack.strategies.map((strategy, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-700">{strategy}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'exercise' && (
          <div className="space-y-6">
            {mockExercises.map((exercise, index) => (
              <div key={exercise.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">练习 {index + 1}</h3>
                <p className="text-gray-700 mb-4">{exercise.question}</p>
                <div className="space-y-2">
                  {exercise.options.map((option, optIndex) => {
                    const isSelected = selectedAnswers[index] === optIndex
                    const isCorrect = optIndex === exercise.correctAnswer
                    let optionStyle = 'border-gray-200 hover:border-indigo-400'
                    if (showResults) {
                      if (isCorrect) {
                        optionStyle = 'border-green-500 bg-green-50'
                      } else if (isSelected && !isCorrect) {
                        optionStyle = 'border-red-500 bg-red-50'
                      }
                    } else if (isSelected) {
                      optionStyle = 'border-indigo-500 bg-indigo-50'
                    }
                    return (
                      <button
                        key={optIndex}
                        onClick={() => !showResults && handleAnswer(index, optIndex)}
                        disabled={showResults}
                        className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors ${optionStyle}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium ${
                            isSelected && !showResults ? 'bg-indigo-600 text-white' :
                            showResults && isCorrect ? 'bg-green-500 text-white' :
                            showResults && isSelected && !isCorrect ? 'bg-red-500 text-white' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {String.fromCharCode(65 + optIndex)}
                          </span>
                          <span className="text-gray-700">{option}</span>
                          {showResults && isCorrect && <CheckCircle2 className="w-5 h-5 text-green-500 ml-auto" />}
                          {showResults && isSelected && !isCorrect && <XCircle className="w-5 h-5 text-red-500 ml-auto" />}
                        </div>
                      </button>
                    )
                  })}
                </div>
                {showResults && (
                  <div className={`mt-4 p-4 rounded-xl ${
                    selectedAnswers[index] === exercise.correctAnswer ? 'bg-green-50' : 'bg-orange-50'
                  }`}>
                    <p className={`font-medium mb-1 ${
                      selectedAnswers[index] === exercise.correctAnswer ? 'text-green-700' : 'text-orange-700'
                    }`}>
                      {selectedAnswers[index] === exercise.correctAnswer ? '回答正确！' : '回答错误'}
                    </p>
                    <p className={`text-sm ${
                      selectedAnswers[index] === exercise.correctAnswer ? 'text-green-600' : 'text-orange-600'
                    }`}>
                      {exercise.explanation}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {!showResults ? (
              <div className="flex justify-center">
                <Button 
                  size="lg" 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-8"
                  onClick={checkAnswers}
                  disabled={selectedAnswers.includes(null)}
                >
                  提交答案
                  <CheckCircle2 className="ml-2 w-5 h-5" />
                </Button>
              </div>
            ) : (
              <div className="flex justify-center">
                <Button 
                  size="lg" 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-8"
                  onClick={handleContinue}
                >
                  {completed ? '练习完成，继续验证' : '查看结果，继续验证'}
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}