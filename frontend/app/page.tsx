import { Button } from "@/components/ui/button"
import { ArrowRight, BookOpen, Users, Award } from "lucide-react"

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl text-gray-800">POA English</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-gray-600 hover:text-indigo-600 transition-colors">功能特色</a>
            <a href="#about" className="text-gray-600 hover:text-indigo-600 transition-colors">关于我们</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        <section className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
            <Award className="w-4 h-4" />
            产出导向法驱动的英语学习
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
            在实景情境中
            <span className="text-indigo-600"> 提升英语交际能力</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-8">
            上传实景照片，系统自动生成POA驱动任务。与AI角色对话，获得精准诊断和个性化学习建议，形成完整的学习证据链。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              size="lg" 
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-6 text-lg"
              onClick={() => window.location.href = '/scenario'}
            >
              立即开始学习
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="px-8 py-6 text-lg"
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            >
              了解更多
            </Button>
          </div>
        </section>

        <section id="features" className="grid md:grid-cols-3 gap-6 mb-16">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
              <BookOpen className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="font-semibold text-lg text-gray-900 mb-2">实景情境学习</h3>
            <p className="text-gray-600">上传实景照片，触发真实语境，生成个性化学习任务。</p>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-gray-900 mb-2">AI对话练习</h3>
            <p className="text-gray-600">与AI角色进行英文对话，获得即时反馈和精准诊断。</p>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-4">
              <Award className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="font-semibold text-lg text-gray-900 mb-2">双轨评价体系</h3>
            <p className="text-gray-600">对比两轮表现，可视化学习进步，形成完整证据链。</p>
          </div>
        </section>

        <section id="about" className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">什么是POA学习法？</h2>
          <p className="text-gray-600 mb-6">
            产出导向法（Production-Oriented Approach）是一种强调"产出驱动"的教学方法。
            学习者通过完成真实交际任务来提升语言能力，遵循"实景情境—产出尝试—输入促成—双轨评价—产出验证"的四步闭环。
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {['实景情境', '产出尝试', '输入促成', '双轨评价', '产出验证'].map((step, index) => (
              <div key={index} className="text-center p-4 bg-gray-50 rounded-xl">
                <div className="text-2xl font-bold text-indigo-600 mb-2">{index + 1}</div>
                <div className="text-sm font-medium text-gray-700">{step}</div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="bg-gray-50 border-t border-gray-100 mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8 text-center text-gray-500 text-sm">
          <p>POA English Learning Platform © 2024</p>
        </div>
      </footer>
    </div>
  )
}