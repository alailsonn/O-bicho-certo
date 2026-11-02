"""Atualiza o histórico da LOOK Goiás sem alterar o coletor da LOTECE.

Fontes públicas não oficiais: Bicho Certo (resultados recentes) e
O Jogo do Bicho (histórico por data). Não inventa nem sobrescreve sorteios.
"""
import json
import os
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

URL_RECENTE = 'https://bichocerto.com/resultados/lk/look/'
URL_HISTORICO = 'https://www.ojogodobicho.com/look/resultados-anteriores.htm'
DESTINO = 'data/look/results.json'
HORARIOS = {'07:20', '09:20', '11:20', '14:20', '16:20', '18:20', '19:20', '21:20', '23:20'}
SESSAO = requests.Session()
SESSAO.headers.update({'User-Agent': 'Mozilla/5.0 (compatible; O-Bicho-Certo/1.0)'})


def resultado(data, horario, premios):
    """Valida um sorteio completo, sempre com cinco milhares de quatro dígitos."""
    if horario not in HORARIOS or len(premios) != 5:
        return None
    if any(not re.fullmatch(r'\d{4}', str(p)) for p in premios):
        return None
    return {'date': data, 'time': horario, 'contest': '', 'p': [str(p) for p in premios]}


def extrair_bicho_certo(html):
    """Lê cartões 'Resultado LOOK-GO HH:MM' sem supor que a página seja de hoje."""
    texto = BeautifulSoup(html, 'html.parser').get_text('\n', strip=True)
    secoes = re.split(r'Resultado\s+LOOK-GO\s+(\d{1,2}:\d{2})\b', texto, flags=re.I)
    registros = []
    for i in range(1, len(secoes) - 1, 2):
        horario = secoes[i].zfill(5)
        bloco = secoes[i + 1]
        achado_data = re.search(r'\b(\d{2}/\d{2}/\d{4})\b', bloco[:250])
        if not achado_data:
            continue
        data = datetime.strptime(achado_data.group(1), '%d/%m/%Y').date().isoformat()
        # Delimita os prêmios pelo marcador 1º, 2º, ... para não capturar
        # milhar de outro prêmio, grupo do bicho nem SUPER 5.
        marcadores = list(re.finditer(r'(?m)^\s*([1-5])\s*[º°]\s*$', bloco))
        mapa = {}
        for pos, item in enumerate(marcadores):
            limite = marcadores[pos + 1].start() if pos + 1 < len(marcadores) else len(bloco)
            trecho = bloco[item.end():limite]
            milhar = re.search(r'(?<!\d)(\d{4})(?!\d)', trecho)
            if milhar:
                mapa[int(item.group(1))] = milhar.group(1)
        registro = resultado(data, horario, [mapa[k] for k in range(1, 6)]) if all(k in mapa for k in range(1, 6)) else None
        if registro:
            registros.append(registro)
    if not registros:
        raise ValueError('Não foram encontrados cartões completos LOOK-GO no Bicho Certo')
    return registros


def extrair_historico(html, data):
    """Lê uma tabela de data específica, sem confundir opções do calendário."""
    soup = BeautifulSoup(html, 'html.parser')
    texto = soup.get_text(' ', strip=True)
    data_pt = datetime.strptime(data, '%Y-%m-%d').strftime('%d/%m/%Y')
    # A data deve estar no TÍTULO de resultados, não somente no seletor de datas.
    titulo = re.search(r'Resultado\s+da\s+LOOK\s+Goiás\s+de\b.{0,100}?\b(\d{2}/\d{2}/\d{4})\b', texto, re.I)
    if not titulo or titulo.group(1) != data_pt:
        raise ValueError(f'A página não confirma resultados de {data_pt}')
    for tabela in soup.find_all('table'):
        linhas = tabela.find_all('tr')
        if len(linhas) < 6:
            continue
        cabecalho = [c.get_text(' ', strip=True) for c in linhas[0].find_all(['th', 'td'])]
        colunas = {}
        for pos, nome in enumerate(cabecalho):
            m = re.search(r'\b(?:0?[79]|11|14|16|18|19|21|23):20\b', nome)
            if m and m.group().zfill(5) in HORARIOS:
                colunas[pos] = m.group().zfill(5)
        if not colunas:
            continue
        mapas = {h: {} for h in colunas.values()}
        for linha in linhas[1:]:
            celulas = linha.find_all(['th', 'td'], recursive=False)
            if not celulas:
                continue
            rotulo = celulas[0].get_text(' ', strip=True)
            m = re.search(r'\b([1-5])\s*[º°]', rotulo)
            if not m:
                continue
            premio = int(m.group(1))
            for coluna, horario in colunas.items():
                if coluna < len(celulas):
                    valor = re.search(r'(?<!\d)(\d{4})(?!\d)', celulas[coluna].get_text(' ', strip=True))
                    if valor:
                        mapas[horario][premio] = valor.group(1)
        registros = []
        for horario, mapa in mapas.items():
            if all(k in mapa for k in range(1, 6)):
                registro = resultado(data, horario, [mapa[k] for k in range(1, 6)])
                if registro:
                    registros.append(registro)
        if registros:
            return registros
    raise ValueError(f'Nenhuma tabela completa encontrada para {data_pt}')


def carregar():
    if not os.path.exists(DESTINO):
        return []
    with open(DESTINO, encoding='utf-8') as f:
        dados = json.load(f)
    if not isinstance(dados, list):
        raise ValueError('Histórico existente inválido; arquivo preservado')
    return dados


def main():
    hoje = datetime.now(ZoneInfo('America/Sao_Paulo')).date()
    dias = {(hoje - timedelta(days=n)).isoformat() for n in range(4)}
    antigos = carregar()
    # Preserva registros existentes exatamente como estão.
    mapa = {(r.get('date'), r.get('time')): r for r in antigos if isinstance(r, dict)}
    novos, divergencias, fontes_ok = 0, 0, 0
    erros = []

    def incorporar(registros, fonte):
        nonlocal novos, divergencias
        for r in registros:
            if r['date'] not in dias:
                continue
            chave = (r['date'], r['time'])
            anterior = mapa.get(chave)
            if anterior is None:
                mapa[chave] = r
                novos += 1
            elif anterior.get('p') != r['p']:
                divergencias += 1
                print(f'AVISO: resultados diferentes em {chave} ({fonte}); mantido o histórico original')

    # Fonte indicada pelo usuário: consulta os cartões recém-publicados.
    try:
        resp = SESSAO.get(URL_RECENTE, timeout=30)
        resp.raise_for_status()
        registros = extrair_bicho_certo(resp.text)
        incorporar(registros, 'Bicho Certo')
        fontes_ok += 1
        print(f'Bicho Certo: {len(registros)} extrações encontradas')
    except (requests.RequestException, ValueError) as exc:
        erros.append(f'Bicho Certo: {exc}')

    # Fonte secundária para recuperar extrações atrasadas dos dias recentes.
    for dia in sorted(dias):
        try:
            resp = SESSAO.get(URL_HISTORICO, params={'d': dia}, timeout=30)
            resp.raise_for_status()
            registros = extrair_historico(resp.text, dia)
            incorporar(registros, 'histórico')
            fontes_ok += 1
        except (requests.RequestException, ValueError) as exc:
            erros.append(f'{dia} no histórico: {exc}')

    if novos:
        os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
        # Não apagar registros desconhecidos, mesmo que estejam fora do período.
        todos = sorted(mapa.values(), key=lambda r: (r.get('date', ''), r.get('time', '')))
        temporario = DESTINO + '.tmp'
        with open(temporario, 'w', encoding='utf-8') as f:
            json.dump(todos, f, ensure_ascii=False, indent=2)
        os.replace(temporario, DESTINO)
    print(f'LOOK Goiás: {novos} novos, {len(mapa)} no histórico, {divergencias} divergência(s)')
    for erro in erros:
        print('AVISO:', erro)
    if fontes_ok == 0:
        raise RuntimeError('Nenhuma fonte pôde ser validada; histórico preservado')


if __name__ == '__main__':
    main()
