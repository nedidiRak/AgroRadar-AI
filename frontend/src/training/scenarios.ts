export type TrainingView = 'overview' | 'fields' | 'operations' | 'assistant'
type Topic = 'start' | 'overview' | 'map' | 'weather' | 'risk' | 'ai' | 'work' | 'layout' | 'finish'
export type Step = {
  id: string; topic: Topic; view: TrainingView; target?: string; title: string; text: string
  action?: 'click' | 'change' | 'practice'; hint?: string; optional?: boolean
}
export const version = 1
export const topics: Record<Topic, string> = {
  start:'Знакомство', overview:'Сводка', map:'Карта полей', weather:'Погода', risk:'Оценка риска',
  ai:'ИИ-агроном', work:'Работа в поле', layout:'Рабочее пространство', finish:'Завершение',
}
const welcome: Step = {id:'welcome', topic:'start', view:'overview', target:'page-heading', title:'Начнём с хозяйства',
  text:'Обзор собирает прогнозы по участкам. Выберите поле, проследите путь от погодного сигнала до проверки на месте и задайте вопрос по этому полю.'}
const choose: Step = {id:'choose-field',topic:'map',view:'fields',target:'field-choice',title:'Выберите участок',
  text:'Нажмите название поля в списке рядом с картой. Выбранный участок станет контекстом для прогноза и диалога с ИИ.',
  action:'click',hint:'Нажмите на поле'}
const weather: Step = {id:'weather',topic:'weather',view:'overview',target:'forecast-chart',title:'Прочитайте прогноз',
  text:'По горизонтали указано местное для браузера время, по вертикали — температура. Найдите самый холодный интервал. В почасовых карточках процент означает вероятность осадков.',optional:true}
const alerts: Step = {id:'alerts',topic:'weather',view:'operations',target:'alert-filter',title:'Отберите предупреждения',
  text:'Выберите другой статус в списке. Каждая запись связывает прогноз с полем и причиной угрозы. При демонстрационных данных список может быть пуст.',
  action:'change',hint:'Смените статус в списке'}
const risk: Step = {id:'risk',topic:'risk',view:'fields',target:'risk-legend',title:'Прочитайте цвета риска',
  text:'Зелёный означает низкий риск, жёлтый — умеренный, красный — высокий. Откройте сводку выбранного поля, чтобы узнать причину. Пометка «Нет данных» означает, что оценка недоступна.'}
const question: Step = {id:'question',topic:'ai',view:'assistant',target:'ai-composer',title:'Составьте вопрос по полю',
  text:'Укажите период и то, что хотите проверить. Например, «Какие признаки после холодной ночи стоит проверить на этом поле?» Учебный вопрос остаётся в браузере.',
  action:'practice',hint:'Введите вопрос и нажмите «Проверить вопрос»'}
const interpret: Step = {id:'interpret',topic:'ai',view:'assistant',target:'ai-conversation',title:'Проверьте рекомендацию',
  text:'В рабочем диалоге ответ появится здесь. Сопоставьте основание совета с прогнозом и журналом осмотров. Перед агротехническими действиями вывод должен проверить агроном.'}
const finish: Step = {id:'finish',topic:'finish',view:'overview',title:'Маршрут пройден!',
  text:'Теперь вы можете выбрать поле, оценить погодный риск и обсудить вывод с ИИ. Вернуться к маршруту всегда можно из настроек.'}
const studio: Step[] = [
  {id:'studio',topic:'layout',view:'overview',target:'workspace-toolbar',title:'Попробуйте конструктор',
    text:'Откройте учебную копию рабочего пространства. В ней вы добавите график, передвинете его и измените размер. Ваш макет и его черновик сохранятся.',hint:'Открыть учебный макет'},
  {id:'catalog',topic:'layout',view:'overview',target:'catalog-toggle',title:'Откройте каталог',
    text:'В каталоге собраны доступные виджеты. Нажмите «Добавить виджет» в панели конструктора.',action:'click',hint:'Откройте каталог виджетов'},
  {id:'add-widget',topic:'layout',view:'overview',target:'add-temperature',title:'Добавьте график',
    text:'Выберите «График температуры». На рабочем пространстве появится отдельный график выбранного поля.',action:'click',hint:'Выберите график в каталоге'},
  {id:'move-widget',topic:'layout',view:'overview',target:'practice-tools',title:'Измените положение',
    text:'Перетащите график за заголовок или нажмите стрелку «Выше». Соседние блоки освободят место.',action:'practice',hint:'Передвиньте учебный график'},
  {id:'resize-widget',topic:'layout',view:'overview',target:'size-controls',title:'Измените высоту',
    text:'В параметрах графика введите другую высоту в строках и нажмите Enter или перейдите к следующей кнопке. Можно также потянуть за маркер на границе блока.',action:'practice',hint:'Измените размер графика'},
  {id:'save-layout',topic:'layout',view:'overview',target:'save-layout',title:'Сохраните учебный вариант',
    text:'Нажмите «Сохранить». В рабочем режиме эта кнопка записывает персональный макет в аккаунт. Сейчас она завершит упражнение и вернёт ваш интерфейс.',action:'practice',hint:'Нажмите «Сохранить» в конструкторе'},
]
export const practiceStages = new Set(studio.slice(1).map(step => step.id))
export const observerSteps: Step[] = [welcome, choose, weather, alerts, risk, question, interpret, finish]
export const adminSteps: Step[] = [welcome,
  {id:'overview',topic:'overview',view:'overview',target:'overview-stats',title:'Оцените ситуацию в хозяйстве',
    text:'Сравните число полей и участков с высоким риском. Для проверки конкретного участка перейдите к карте через меню.',optional:true},
  choose, {id:'boundary',topic:'map',view:'fields',target:'map-new',title:'Как добавить границу',
    text:'На доступной карте Яндекса кнопка «Новое поле» включает рисование. Отметьте минимум три вершины, затем укажите название и культуру и подтвердите сохранение. Сейчас мы только рассматриваем кнопку.'},
  weather,alerts,risk,question,interpret,
  {id:'journal',topic:'work',view:'fields',target:'field-journal',title:'Откройте журнал наблюдений',
    text:'В журнале хранятся датированные записи осмотров. Раскройте его у выбранного поля. На практике сюда вносят то, что увидели на участке.',action:'click',hint:'Нажмите «Журнал наблюдений»'},
  {id:'task',topic:'work',view:'operations',target:'new-task',title:'Откройте форму задания',
    text:'Нажмите «Новое задание», чтобы посмотреть поля формы. Для упражнения достаточно её открыть.',action:'click',hint:'Нажмите «Новое задание»'},
  {id:'task-form',topic:'work',view:'operations',target:'task-preview',title:'Свяжите проверку с полем',
    text:'В форме указывают поле, название и что именно проверить. Можно назначить ответственного и срок. После сохранения ход работы виден в списке заданий. Здесь доступен учебный просмотр.'},
  ...studio, {...finish,text:'Вы прошли путь от выбора участка до полевого задания и настроили учебный макет. Выберите своё поле и начните с прогноза на ближайшие сутки.'},
]
