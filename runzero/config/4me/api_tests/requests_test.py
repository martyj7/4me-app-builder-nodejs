import requests

url = 'https://console.runzero.com/api/v1.0/account/api/token'
body = {'client_id': 'd6dae5e4-4a26-4408-992a-a76d94502148', 'client_secret': 'hiSjvgoejvxVjMgugWTBIJ+rpm72kdXoqcLts5pV2dE=', 'grant_type': 'client_credentials'}


x = requests.post(url, data=body)

print(x.content)