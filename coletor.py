import os
import re
import json
import requests
from datetime import datetime

URL = "https://lotece.com.br/"
ARQUIVO = "data/results.json"

def buscar_resultados():
    resposta = requests.get(URL, timeout=30)
    resposta.raise_for_status()

    texto = re.sub(
        r"<[^>]+>", " ",
        resposta.text
    )
    texto = re.sub(r"\s+", " ", texto)

    padrao = (
        r"Extração\s+(Manhã|Tarde II|Tarde|Noite)"
        r"\s+Dia\s+(\d{2}/\d{2}/\d{4})"
        r"(.*?)(?=Extração\s+|$)"
    )

    registros = []

    for nome, data, bloco in re.findall(
        padrao, texto, re.I | re.S
    ):
        premios = re.findall(
            r"(\d{1,2})[°º]\s*PRÊMIO\s*(\d{4})",
            bloco,
            re.I
        )
        mapa = {int(n): v for n, v in premios}

        if not all(n in mapa for n in range(1, 6)):
            continue

        dia = datetime.strptime(
            data, "%d/%m/%Y"
        ).strftime("%Y-%m-%d")

        registros.append({
            "date": dia,
            "time": nome,
            "contest": "",
            "p": [mapa[n] for n in range(1, 6)]
        })

    if not registros:
        raise ValueError(
            "Nenhum resultado válido encontrado."
        )

    os.makedirs("data", exist_ok=True)

    antigos = []
    if os.path.exists(ARQUIVO):
        with open(ARQUIVO, encoding="utf-8") as f:
            antigos = json.load(f)

    if not isinstance(antigos, list):
        raise ValueError("Histórico inválido.")

    chaves = {
        (r.get("date"), r.get("time"))
        for r in antigos
        if isinstance(r, dict)
    }

    novos = [
        r for r in registros
        if (r["date"], r["time"]) not in chaves
    ]

    todos = antigos + novos

    with open(ARQUIVO, "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)

    print(f"Novos resultados: {len(novos)}")
    print(f"Total: {len(todos)}")

if __name__ == "__main__":
    buscar_resultados()
