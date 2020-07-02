const rax = require('retry-axios');
const axios = require('axios');
rax.attach();
const Iconv = require('iconv').Iconv;
const cheerio = require('cheerio');
const fs = require('fs');

const topLevel = '100100163596969'; // «Корневой» идентификатор, по которому выводится список регионов
const perLevel = [0, 0, 0];
const totalPerLevel = [87, 2687]; // 87 регионов, 2687 ТИКов

// Создает папку для JSON-файлов с именем вида 'DD.MM.YYYY H-mm'
const startDate = new Date();
const dir = `${startDate.getDate() < 10 ? '0' : ''}${startDate.getDate()}.${startDate.getMonth() + 1 < 10 ? '0' : ''}${startDate.getMonth() + 1}.${startDate.getFullYear()} ` +
  `${startDate.getHours()}-${startDate.getMinutes() < 10 ? '0' : ''}${startDate.getMinutes()}`;
fs.mkdirSync(dir);

// getPage скачивает страницу по заданному идентификатору. ЦИК не в курсе про существование юникода, поэтому приходится конвертировать кодировку самим.
conv = Iconv('windows-1251', 'utf8');
const getPage = (vibid) => {
  return axios.get(`http://www.vybory.izbirkom.ru/region/region/izbirkom?action=show&vrn=100100163596966&vibid=${vibid}&type=465`, {
    headers: {
      Cookie: 'izbirkomSession=PASTE_YOUR_SESSIONID_HERE', // <- Вставить куку после ввода капчи из браузера
    },
    responseType: 'arraybuffer',
    responseEncoding: 'binary',
    timeout: 3000,
    raxConfig: { // Страницы с результатами могут подвисать, поэтому повторяем попытки, пока сервер не сдастся.
      retry: 50,
      noResponseRetries: 100,
    },
  }).then((resp) => {
    return conv.convert(resp.data).toString();
  });
};

// processLevel загружает данные с одной страницы (списка регионов, одного региона или одного ТИКа в регионе) и сохраняет в формате JSON.
// vibid - идентификатор региона/комиссии
// level - глубина в иерархии (0 - список регионов, 1 - список ТИКов в регионе, 2 - список УИКов в ТИКе)
// status - текстовое описание для вывода прогресса в консоль
const processLevel = async (vibid, level, status = '') => {
  if (status) {
    console.log(status);
  }

  // «Территория за пределами РФ» — исключительный «регион», находится на уровне ТИКа
  if (vibid == '100100164050020') {
    level++;
  }

  const html = await getPage(vibid);
  const $ = cheerio.load(html);
  const rows = $('tr tr tr'); // Про существование CSS-классов ЦИК тоже не в курсе. Поэтому тр-тр-тр.
  const header = rows.eq(8).find('a').get();
  const voters = rows.eq(9).find('b').get();
  const totals = rows.eq(10).find('b').get();
  const voted = rows.eq(11).find('b').get();
  const spoiled = rows.eq(12).find('b').get();
  const yays = rows.eq(14).find('b').get();
  const nays = rows.eq(15).find('b').get();

  const childs = [];
  for (let i = 0; i < header.length; i++) {
    childs.push({
      committee: $(header[i]).text(),                               // Название региона/комиссии
      vibid: $(header[i]).prop('href').match(/vibid=([0-9]+)/)[1],  // Идентификатор региона/комиссии
      voters: parseInt($(voters[i]).text(), 10),                    // Общее число избирателей
      total: parseInt($(totals[i]).text(), 10),                     // Число выданных бюллетеней (т.е. явка)
      voted: parseInt($(voted[i]).text(), 10),                      // Число бюллетеней в урнах (те, что не унесли с собой)
      spoiled: parseInt($(spoiled[i]).text(), 10),                  // Число недействительных бюллетеней
      yays: parseInt($(yays[i]).text(), 10),                        // Число голосов «за»
      nays: parseInt($(nays[i]).text(), 10),                        // Число голосов «против»
    });
  }

  fs.writeFileSync(`${dir}/${level}-${vibid}.json`, JSON.stringify(childs));

  if (level < 2) {
    for (let child of childs) {
      perLevel[level]++;
      // Спускаемся на уровень ниже. Процесс не распараллелен чтобы не давить слишком сильно на бедные сервера ЦИКа.
      await processLevel(child.vibid, level + 1, `${status ? status + ' → ' : ''}[${perLevel[level]}/${totalPerLevel[level]}] ${child.committee}`);
    }
  } else {
    perLevel[level] += childs.length;
  }
}

(async () => {
  // Рекурсивно обходит все регионы и комиссии, начиная с корневой страницы.
  await processLevel(topLevel, 0);

  // Выводит статистику о количестве регионов/комиссий на каждом уровне.
  console.log('По уровням: ', perLevel);
})();