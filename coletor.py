import os
import requests

def buscar_resultados():
    url = os.getenv("RESULTADOS_URL")

    if not url:
        print("Fonte de resultados ainda não configurada.")
        return

    try:
        resposta = requests.get(url, timeout=20)
        resposta.raise_for_status()
        print("Consulta realizada com sucesso.")
        print("Resposta recebida:", len(resposta.content), "bytes")
    except requests.RequestException as erro:
        print("Erro ao consultar resultados:", erro)

if __name__ == "__main__":
    buscar_resultados()
